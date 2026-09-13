import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Pencil, Plus, Upload } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { PersonAssetImage, PersonAssetSummary, RecycledPersonAsset } from '../../shared/person-assets';
import { useAsyncAction } from '../../ui/async-action';
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
  const [message, setMessage] = useState(isBrowserPreview ? '浏览器预览不能导入或读取本地图片，请在 Electron 应用中管理素材。' : '');
  const [pendingAction, setPendingAction] = useState<'create' | 'rename' | 'delete' | 'import' | 'open' | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ name: string; references: { taskId: string; title: string; status: string }[] } | null>(null);
  const [recycled, setRecycled] = useState<RecycledPersonAsset | null>(null);
  const previewRequest = useRef(0);
  const personAction = useAsyncAction();
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

  async function refreshPeople(nextSelectedName = selectedName) {
    await personAction.run(() => loadPeople(nextSelectedName));
  }

  async function createPerson() {
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
    if (!selectedName) return;
    const name = selectedName;
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
    await personAction.run(async () => {
      setPendingAction('delete');
      try {
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
    if (!recycled?.token) return;
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
    if (!selectedAsset?.dir) return;
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
          <input value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="人物名称" />
          <button className="ghost-action compact-action" type="button" disabled={pendingAction !== null} onClick={createPerson}>
            <Plus size={15} />
            创建
          </button>
        </div>
        <div className="person-list">
          {people.length === 0 ? <EmptyState title="暂无人物素材" /> : null}
          {people.map((person) => (
            <button key={person.name} className={person.name === selectedName ? 'person-list-item active' : 'person-list-item'} type="button" onClick={() => setSelectedName(person.name)}>
              <strong>{person.name}</strong>
              <span>{person.count} 张图片</span>
            </button>
          ))}
        </div>
      </section>

      <section className="local-lab-main person-assets-panel">
        <div className="panel-title-row">
          <div>
            <h3>{selectedName || '选择人物'}</h3>
            <span>{selectedAsset?.dir || '创建人物后可导入本地图片'}</span>
          </div>
          <div className="button-row">
            {selectedAsset?.dir ? (
              <button className="ghost-action compact-action" type="button" disabled={pendingAction !== null} onClick={openSelectedAssetDir}>
                <FolderOpen size={15} />
                打开目录
              </button>
            ) : null}
            <button className="primary-action slim" type="button" disabled={!selectedName || pendingAction !== null} onClick={importImages}>
              <Upload size={15} />
              导入图片
            </button>
          </div>
        </div>

        {selectedName ? (
          <div className="person-asset-tools">
            <Field label="人物名称">
              <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
            </Field>
            <div className="button-row person-asset-actions">
              <button className="ghost-action compact-action" type="button" disabled={!renameValue.trim() || renameValue.trim() === selectedName || pendingAction !== null} onClick={renamePerson}>
                <Pencil size={15} />
                重命名
              </button>
              <button className="mini-button" type="button" disabled={pendingAction !== null} onClick={deletePerson}>{deleteConfirmation?.name === selectedName ? '确认删除' : '删除'}</button>
            </div>
            {deleteConfirmation?.name === selectedName ? <span className="local-note">{deleteConfirmation.references.length > 0 ? '该人物仍被任务引用，不能删除。' : '再次点击确认，素材将移入回收区。'}</span> : null}
          </div>
        ) : null}

        <div className="person-image-grid">
          {images.length === 0 ? <EmptyState title="暂无图片" /> : null}
          {images.map((image) => (
            <article className="person-image-card" key={image.path}>
              {imageUrls[image.path]
                ? <img src={imageUrls[image.path]} alt={image.name} data-media-canvas="person-assets" />
                : <div className="person-image-placeholder" data-media-canvas="person-assets">{image.name}</div>}
              <span title={image.path}>{image.name}</span>
            </article>
          ))}
        </div>
        {message ? <span className="local-note">{message}</span> : null}
        {recycled ? <button className="ghost-action compact-action" type="button" disabled={pendingAction !== null} onClick={undoDelete}>撤销删除</button> : null}
        <InlineActionFeedback feedback={personAction.feedback} />
      </section>
    </div>
  );
}
