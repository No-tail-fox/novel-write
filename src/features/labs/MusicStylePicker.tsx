import { useRef, useState } from 'react';
import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button, CheckboxField, Dialog, SegmentedControl, TextField } from '../../ui';
import { MUSIC_STYLE_GROUPS, type MusicStyleTag } from './music-style-catalog';
import { MUSIC_STYLE_COUNT, findMusicStyles, mergeMusicStyles, musicStyleKey, selectedMusicStyles } from './music-styles';
import './music-style-picker.css';

export function MusicStylePickerButton({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  return <>
    <Button density="compact" variant="subtle" icon={<SlidersHorizontal size={14} />} disabled={disabled} onClick={event => { trigger.current = event.currentTarget; setOpen(true); }}>选择风格 · {MUSIC_STYLE_COUNT}</Button>
    {open && <MusicStylePicker initialValue={value} onClose={close} onApply={(next) => { onChange(next); close(); }} />}
  </>;
}

function MusicStylePicker({ initialValue, onClose, onApply }: {
  initialValue: string; onClose: () => void; onApply: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState(MUSIC_STYLE_GROUPS[0].id);
  const [categoryId, setCategoryId] = useState(MUSIC_STYLE_GROUPS[0].categories[0].id);
  const [selected, setSelected] = useState(() => selectedMusicStyles(initialValue));
  const [english, setEnglish] = useState(true);
  const group = MUSIC_STYLE_GROUPS.find(item => item.id === groupId)!;
  const category = group.categories.find(item => item.id === categoryId) ?? group.categories[0];
  const searching = !!query.trim();
  const tags = searching ? findMusicStyles(query) : category.tags;
  const selectedKeys = new Set(selected.map(musicStyleKey));
  const result = mergeMusicStyles(initialValue, selected, english);
  const tooLong = result.length > 5000;
  function toggle(tag: MusicStyleTag) {
    const key = musicStyleKey(tag);
    setSelected(current => current.some(item => musicStyleKey(item) === key)
      ? current.filter(item => musicStyleKey(item) !== key) : [...current, tag]);
  }
  return <Dialog open title="选择风格" onOpenChange={open => { if (!open) onClose(); }} actions={<>
    <Button onClick={onClose}>取消</Button>
    <Button variant="primary" disabled={tooLong} onClick={() => onApply(result)}>应用风格</Button>
  </>}>
    <div className="music-style-picker">
      <div className="music-style-picker__search">
        <TextField label="搜索风格标签" placeholder="搜索全部分类，中英文都可以" contentBefore={<Search size={16} />} value={query} onChange={(_, data) => setQuery(data.value)} />
        <CheckboxField label="使用英文标签" checked={english} onChange={(_, data) => setEnglish(data.checked === true)} />
      </div>
      <SegmentedControl className="music-style-picker__groups" label="风格分类" value={groupId} onChange={next => {
        setGroupId(next); setCategoryId(MUSIC_STYLE_GROUPS.find(item => item.id === next)!.categories[0].id); setQuery('');
      }} options={MUSIC_STYLE_GROUPS.map(item => ({ value: item.id, label: item.label }))} />
      {!searching && <SegmentedControl className="music-style-picker__categories" label="风格子分类" value={category.id} onChange={setCategoryId} options={group.categories.map(item => ({ value: item.id, label: item.label }))} />}
      <div className="music-style-picker__results" role="group" aria-label={searching ? '风格搜索结果' : `${group.label} · ${category.label}`}>
        {tags.map(tag => {
          const active = selectedKeys.has(musicStyleKey(tag));
          return <Button key={`${tag.zh}/${tag.en}`} className="music-style-picker__tag" aria-pressed={active} title={`${tag.zh} · ${tag.en}`} variant={active ? 'primary' : 'secondary'} onClick={() => toggle(tag)}>
            <span className="music-style-picker__tag-label">{active && <Check size={13} aria-hidden="true" />}{tag.zh}</span>
            <span className="music-style-picker__translation">{tag.en}</span>
          </Button>;
        })}
        {!tags.length && <p className="music-style-picker__empty">没有匹配的标签，仍可在音乐风格中手动填写。</p>}
      </div>
      <div className="music-style-picker__summary" role="status">
        <span>已选 {selected.length} 个 · 共 {MUSIC_STYLE_COUNT} 个标签{searching ? ` · 找到 ${tags.length} 项` : ''}</span>
        <Button density="compact" variant="subtle" disabled={!selected.length} onClick={() => setSelected([])}>清空已选</Button>
      </div>
      {!!selected.length && <div className="music-style-picker__selected" role="group" aria-label="已选风格">
        {selected.map(tag => <Button key={musicStyleKey(tag)} density="compact" variant="subtle" icon={<X size={12} />} iconPosition="after" aria-label={`移除 ${tag.zh}`} onClick={() => toggle(tag)}>{tag.zh}</Button>)}
      </div>}
      <p className="music-style-picker__hint">标签会合并到音乐风格，保留手动填写的其他内容。</p>
      {tooLong && <p className="music-style-picker__error" role="alert">合并后超过 5000 字符，请减少标签后应用。</p>}
    </div>
  </Dialog>;
}
