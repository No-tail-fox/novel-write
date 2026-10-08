import { useEffect, useRef, useState } from 'react';
import { Check, ImageOff, Loader2, RefreshCw } from 'lucide-react';
import type { PersonAssetImage, PersonAssetSummary } from '../../shared/person-assets';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { VideoReferenceImage } from '../../shared/video-lab';
import { Button, Dialog, SelectField } from '../../ui';
import { personReferenceImage, togglePersonReference } from './video-lab-person-selection';
import './video-lab-person-picker.css';

export interface VideoLabPersonPickerProps {
  api: StoryDreamApi;
  open: boolean;
  remaining: number;
  excludedPaths?: readonly string[];
  onClose: () => void;
  onAdd: (images: VideoReferenceImage[]) => void;
}

export function VideoLabPersonPicker(props: VideoLabPersonPickerProps) {
  return props.open ? <PersonPickerSession {...props} /> : null;
}

function PersonPickerSession({ api, remaining, excludedPaths = [], onClose, onAdd }: VideoLabPersonPickerProps) {
  const [people, setPeople] = useState<PersonAssetSummary[]>([]);
  const [personName, setPersonName] = useState('');
  const [images, setImages] = useState<PersonAssetImage[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<VideoReferenceImage[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [imagesError, setImagesError] = useState('');
  const [peopleRefresh, setPeopleRefresh] = useState(0);
  const [imagesRefresh, setImagesRefresh] = useState(0);
  const submitted = useRef(false);
  const limit = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
  const availableSelection = selected.filter((item) => !excludedPaths.includes(item.path));
  const atLimit = availableSelection.length >= limit;

  useEffect(() => {
    let active = true;
    setPeopleLoading(true);
    setPeopleError('');
    void api.listPersonAssets().then((items) => {
      if (!active) return;
      setPeople(items);
      setPersonName((current) => items.some((item) => item.name === current) ? current : items[0]?.name ?? '');
    }).catch((error: unknown) => {
      if (active) setPeopleError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setPeopleLoading(false); });
    return () => { active = false; };
  }, [api, peopleRefresh]);

  useEffect(() => {
    let active = true;
    setImages([]);
    setPreviews({});
    setImagesError('');
    setImagesLoading(Boolean(personName));
    if (personName) {
      void api.listPersonAssetImages(personName).then(async (items) => {
        if (!active) return;
        setImages(items);
        setImagesLoading(false);
        const entries = await Promise.all(items.map(async (item) => {
          try { return [item.path, await api.readAssetDataUrl(item.path)] as const; }
          catch { return [item.path, ''] as const; }
        }));
        if (active) setPreviews(Object.fromEntries(entries));
      }).catch((error: unknown) => {
        if (active) setImagesError(error instanceof Error ? error.message : String(error));
      }).finally(() => { if (active) setImagesLoading(false); });
    }
    return () => { active = false; };
  }, [api, personName, imagesRefresh]);

  function addSelection() {
    if (submitted.current || !availableSelection.length || availableSelection.length > limit) return;
    submitted.current = true;
    onAdd(availableSelection);
    onClose();
  }

  return <Dialog open title="从人物素材库添加参考图" onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} actions={<>
    <Button onClick={onClose}>取消</Button>
    <Button variant="primary" disabled={!availableSelection.length || availableSelection.length > limit} onClick={addSelection}>添加已选图片（{availableSelection.length}）</Button>
  </>}>
    <div className="video-lab-person-picker">
      <p className="video-lab-person-picker-note">可跨人物选择图片，添加后用于保持人物外观一致。</p>
      <div className="video-lab-person-picker-status" role="status" aria-live="polite">已选 {availableSelection.length} 张 · 本次最多添加 {limit} 张{atLimit ? ' · 已达上限' : ''}</div>
      {peopleLoading ? <p className="video-lab-person-picker-loading" role="status"><Loader2 size={16} className="spin" />正在读取人物素材库</p>
        : peopleError ? <div className="video-lab-person-picker-error" role="alert"><span>读取人物素材库失败：{peopleError}</span><Button density="compact" icon={<RefreshCw size={14} />} onClick={() => setPeopleRefresh((value) => value + 1)}>重试读取人物</Button></div>
          : !people.length ? <p className="video-lab-person-picker-empty">暂无人物素材。请先在人物素材库创建人物并导入图片。</p>
            : <>
              <SelectField label="人物" value={personName} options={people.map((person) => ({ value: person.name, label: `${person.name} · ${person.count} 张` }))} onChange={(_, data) => { setImages([]); setPreviews({}); setPersonName(data.value); }} />
              {imagesLoading ? <p className="video-lab-person-picker-loading" role="status"><Loader2 size={16} className="spin" />正在读取人物图片</p>
                : imagesError ? <div className="video-lab-person-picker-error" role="alert"><span>读取图片失败：{imagesError}</span><Button density="compact" icon={<RefreshCw size={14} />} onClick={() => setImagesRefresh((value) => value + 1)}>重试读取图片</Button></div>
                  : !images.length ? <p className="video-lab-person-picker-empty">该人物暂无图片，请先在人物素材库导入图片。</p>
                    : <div className="video-lab-person-picker-grid" aria-label={`${personName}的人物图片`}>{images.map((image) => {
                      const included = excludedPaths.includes(image.path);
                      const checked = availableSelection.some((item) => item.path === image.path);
                      return <Button key={image.path} className="video-lab-person-picker-image" variant="subtle" aria-label={`${personName}：${image.name}${included ? '（已添加）' : ''}`} aria-pressed={checked} disabled={included || (!checked && atLimit)} onClick={() => setSelected((current) => togglePersonReference(current.filter((item) => !excludedPaths.includes(item.path)), personReferenceImage(image.path, personName), limit))}>
                        {previews[image.path] ? <img src={previews[image.path]} alt="" loading="lazy" /> : <span className="video-lab-person-picker-placeholder">{previews[image.path] === undefined ? <Loader2 size={24} className="spin" /> : <ImageOff size={24} />}<span>{previews[image.path] === undefined ? '正在读取预览' : '预览不可用'}</span></span>}
                        <span className="video-lab-person-picker-image-label"><span title={image.name}>{image.name}</span>{checked ? <Check size={15} aria-hidden="true" /> : included ? <small>已添加</small> : null}</span>
                      </Button>;
                    })}</div>}
            </>}
      {availableSelection.length ? <div className="video-lab-person-picker-selection" aria-label="已选人物图片">{availableSelection.map((image) => <Button key={image.path} density="compact" title={image.description} aria-label={`取消选择 ${image.description} ${image.path.split(/[\\/]/u).pop()}`} onClick={() => setSelected((current) => current.filter((item) => item.path !== image.path))}>{image.path.split(/[\\/]/u).pop()} · 移除</Button>)}</div> : null}
    </div>
  </Dialog>;
}
