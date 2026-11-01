import { Dropdown, Field, Option, OptionGroup } from '@fluentui/react-components';
import { useState, type ReactElement, type ReactNode } from 'react';
import { HoverPreview } from './HoverPreview';
import { IconButton } from './IconButton';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Maximize2 } from 'lucide-react';
import { mergeStoryDreamClasses } from './utils';

export interface PreviewSelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  preview: () => ReactNode;
  /** Small, noninteractive image displayed alongside the option's label. */
  thumbnail?: () => ReactNode;
  /** Interactive media belongs in the explicit preview, never the hover tooltip. */
  detailPreview?: () => ReactNode;
  disabled?: boolean;
}
export interface PreviewSelectFieldProps {
  label: string | ReactElement;
  value: string;
  options: readonly PreviewSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string | ReactElement;
  fieldClassName?: string;
  className?: string;
  detailLabel?: string;
  showSelectedPreview?: boolean;
  selectedPreviewHint?: string;
}
export function PreviewSelectField({ label, value, options, onChange, disabled, hint, fieldClassName, className, detailLabel, showSelectedPreview, selectedPreviewHint }: PreviewSelectFieldProps) {
  const [open, setOpen] = useState(false), [activeValue, setActiveValue] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const groups = options.reduce<Array<{ label?: string; options: PreviewSelectOption[] }>>((result, option) => {
    if (!result.length || result[result.length - 1].label !== option.group) result.push({ label: option.group, options: [] });
    result[result.length - 1].options.push(option);
    return result;
  }, []);
  const renderOption = (option: PreviewSelectOption) => <HoverPreview key={option.value} title={option.label} description={option.description} renderPreview={option.preview} active={open && activeValue === option.value} disabled={option.disabled}>
    <Option value={option.value} text={option.label} disabled={option.disabled}
      // Enter/leave can fire when keyboard scrolling moves a row under a stationary pointer.
      onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }}
      onPointerLeave={() => setActiveValue(current => current === option.value ? undefined : current)}>{option.thumbnail ? <span className="sd-preview-select-option"><span className="sd-preview-select-thumb" aria-hidden="true">{option.thumbnail()}</span><span>{option.label}</span></span> : option.label}</Option>
  </HoverPreview>;
  return <Field className={mergeStoryDreamClasses('sd-field', fieldClassName)} label={label} hint={hint}>
    <div className="sd-preview-select-row">
    <HoverPreview title={selected?.label ?? value} description={selected?.description} renderPreview={() => selected?.preview()} disabled={open || detailOpen || !selected}>
    <Dropdown className={mergeStoryDreamClasses('sd-preview-select', className)} value={options.find(option => option.value === value)?.label ?? value} selectedOptions={[value]} disabled={disabled} open={open}
      onOpenChange={(_, data) => { setOpen(data.open); if (!data.open) setActiveValue(undefined); }}
      onActiveOptionChange={(_, data) => setActiveValue(data.nextOption?.value)}
      onOptionSelect={(_, data) => { if (data.optionValue !== undefined) onChange(data.optionValue); }}
      // Wide option lists must stay attached to the field rather than flip into a side pane.
      positioning={{ position: 'below', align: 'start', fallbackPositions: ['above-start'], autoSize: 'height' }}
      listbox={{ className: 'sd-preview-select-list' }}>
      {groups.map((group, index) => group.label ? <OptionGroup key={`${group.label}-${index}`} label={group.label}>{group.options.map(renderOption)}</OptionGroup> : group.options.map(renderOption))}
    </Dropdown>
    </HoverPreview>
    {detailLabel ? <Button aria-label={`详细预览${typeof label === 'string' ? label : '当前选项'}`} icon={<Maximize2 size={14} />} disabled={disabled || !selected} onClick={() => { setOpen(false); setDetailOpen(true); }}>{detailLabel}</Button>
      : <IconButton label={`详细预览${typeof label === 'string' ? label : '当前选项'}`} icon={<Maximize2 size={14} />} variant="subtle" disabled={disabled || !selected} onClick={() => { setOpen(false); setDetailOpen(true); }} />}
    </div>
    {showSelectedPreview && selected ? <Button className="sd-preview-select-selected" variant="subtle" disabled={disabled} aria-label={`预览${selected.label}`} onClick={() => { setOpen(false); setDetailOpen(true); }}>
      <span className="sd-preview-select-selected-cover" aria-hidden="true">{selected.preview()}</span>
      <span className="sd-preview-select-selected-copy"><strong>{selected.label}</strong><small>{selectedPreviewHint ?? '效果预览 · 点击放大'}</small></span><Maximize2 size={14} />
    </Button> : null}
    {detailOpen && selected ? <Dialog open title={`${selected.label} · 效果预览`} onOpenChange={setDetailOpen} actions={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}>
      <div className="sd-option-detail-preview" onKeyDownCapture={event => {
        if (event.key === 'Escape' && !document.fullscreenElement) { event.preventDefault(); event.stopPropagation(); setDetailOpen(false); }
      }}>{(selected.detailPreview ?? selected.preview)()}</div>
      {selected.description ? <p className="sd-option-detail-description">{selected.description}</p> : null}
    </Dialog> : null}
  </Field>;
}
