import { useState } from 'react';
import { ImageOff, Maximize2 } from 'lucide-react';
import { Button, Dialog, HoverPreview, PreviewSelectField } from '../../ui';
import { defaultCustomStyles } from '../../shared/config';
import { imageStylePreview } from '../../shared/image-style-previews';
import type { CustomStyle } from '../../shared/types';
import type { TemplateOption } from '../../shared/prompt-templates';
import { toLocalImageUrl } from '../tasks/task-formatters';
import './image-style-preview.css';

export function ImageStyleSample({ style, thumbnail = false }: { style: CustomStyle | string; thumbnail?: boolean }) {
  const sample = imageStylePreview(style);
  return sample ? <img className={thumbnail ? 'image-style-sample-thumb' : 'image-style-sample'} src={sample.local ? toLocalImageUrl(sample.src) : sample.src} alt={`${sample.label}示例图`} loading="lazy" />
    : <div className="image-style-sample-empty"><ImageOff size={thumbnail ? 18 : 25} /><span>{thumbnail ? '暂无样图' : '可在图像模板编辑页生成并保存示例图'}</span></div>;
}

export function ImageStyleSelectedPreview({ style }: { style: CustomStyle | string }) {
  const [open, setOpen] = useState(false);
  const sample = imageStylePreview(style);
  const name = typeof style === 'string' ? defaultCustomStyles.find(item => item.id === style)?.name ?? style : style.name;
  return <>
    <HoverPreview title={name} description={sample?.description} renderPreview={() => <ImageStyleSample style={style} />}>
      <Button className="image-style-selected-preview" variant="subtle" onClick={() => setOpen(true)} aria-label={`查看${name}示例图`}>
        <ImageStyleSample style={style} thumbnail /><span><strong>{name}</strong><small>{sample ? '风格示例 · 点击放大' : '自定义风格 · 暂无样图'}</small></span><Maximize2 size={14} />
      </Button>
    </HoverPreview>
    {open ? <Dialog open title={`${name} · 风格示例`} onOpenChange={setOpen} actions={<Button onClick={() => setOpen(false)}>关闭</Button>}><ImageStyleSample style={style} />{sample?.description ? <p>{sample.description}</p> : null}</Dialog> : null}
  </>;
}

export function ImageStylePicker({ label = '画面风格', value, onChange, styles = defaultCustomStyles, options, disabled, showSelected = true }: {
  label?: string; value: string; onChange: (value: string) => void; styles?: readonly CustomStyle[];
  options?: readonly TemplateOption[]; disabled?: boolean; showSelected?: boolean;
}) {
  const choices = options ?? styles.map(style => [style.id, style.name, style.description] as TemplateOption);
  const resolve = (id: string) => styles.find(style => style.id === id) ?? id;
  return <div className="image-style-picker">
    <PreviewSelectField label={label} value={value} disabled={disabled} onChange={onChange}
      options={choices.map(([id, name, hint]) => ({ value: id, label: name, description: hint, preview: () => <ImageStyleSample style={resolve(id)} /> }))} />
    {showSelected ? <ImageStyleSelectedPreview style={resolve(value)} /> : null}
  </div>;
}
