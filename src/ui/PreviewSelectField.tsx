import { Dropdown, Field, Option } from '@fluentui/react-components';
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
  preview: () => ReactNode;
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
}
export function PreviewSelectField({ label, value, options, onChange, disabled, hint, fieldClassName, className }: PreviewSelectFieldProps) {
  const [open, setOpen] = useState(false), [activeValue, setActiveValue] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  return <Field className={mergeStoryDreamClasses('sd-field', fieldClassName)} label={label} hint={hint}>
    <div className="sd-preview-select-row">
    <HoverPreview title={selected?.label ?? value} description={selected?.description} renderPreview={() => selected?.preview()} disabled={open || detailOpen || !selected}>
    <Dropdown className={mergeStoryDreamClasses('sd-preview-select', className)} value={options.find(option => option.value === value)?.label ?? value} selectedOptions={[value]} disabled={disabled} open={open}
      onOpenChange={(_, data) => { setOpen(data.open); if (!data.open) setActiveValue(undefined); }}
      onActiveOptionChange={(_, data) => setActiveValue(data.nextOption?.value)}
      onOptionSelect={(_, data) => { if (data.optionValue !== undefined) onChange(data.optionValue); }}
      listbox={{ className: 'sd-preview-select-list' }}>
      {options.map(option => <HoverPreview key={option.value} title={option.label} description={option.description} renderPreview={option.preview} active={open && activeValue === option.value} disabled={option.disabled}>
        <Option value={option.value} text={option.label} disabled={option.disabled}>{option.label}</Option>
      </HoverPreview>)}
    </Dropdown>
    </HoverPreview>
    <IconButton label={`详细预览${typeof label === 'string' ? label : '当前选项'}`} icon={<Maximize2 size={14} />} variant="subtle" disabled={!selected} onClick={() => { setOpen(false); setDetailOpen(true); }} />
    </div>
    {detailOpen && selected ? <Dialog open title={`${selected.label} · 效果预览`} onOpenChange={setDetailOpen} actions={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}>
      <div className="sd-option-detail-preview">{selected.preview()}</div>
      {selected.description ? <p className="sd-option-detail-description">{selected.description}</p> : null}
    </Dialog> : null}
  </Field>;
}
