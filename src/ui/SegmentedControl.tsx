import { Tab, TabList } from '@fluentui/react-components';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { mergeStoryDreamClasses } from './utils';
import { Tooltip } from './Tooltip';
import { HoverPreview } from './HoverPreview';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string | ReactElement;
  icon?: ReactElement;
  disabled?: boolean;
  preview?: () => ReactNode;
  previewTitle?: string;
  previewDescription?: string;
}

export interface SegmentedControlProps<T extends string> extends Omit<ComponentProps<typeof TabList>, 'children' | 'onChange' | 'onTabSelect' | 'selectedValue'> {
  label: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean;
  onPreview?: (value: T | null) => void;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, className, iconOnly = false, onPreview, ...props }: SegmentedControlProps<T>) {
  const previewEvents = (option: SegmentedControlOption<T>) => onPreview ? {
    onMouseEnter: () => onPreview(option.value),
    onMouseLeave: () => onPreview(null),
    onFocus: () => onPreview(option.value),
    onBlur: () => onPreview(null),
  } : {};
  return (
    <TabList
      {...props}
      aria-label={label}
      appearance="subtle"
      size="small"
      className={mergeStoryDreamClasses('sd-segmented-control', className)}
      selectedValue={value}
      onTabSelect={(_, data) => onChange(String(data.value) as T)}
    >
      {options.map((option) => option.preview ? (
        <HoverPreview key={option.value} title={option.previewTitle ?? (typeof option.label === 'string' ? option.label : option.value)} description={option.previewDescription} renderPreview={option.preview} disabled={option.disabled}>
          <Tab {...previewEvents(option)} value={option.value} icon={option.icon} disabled={option.disabled}>{option.label}</Tab>
        </HoverPreview>
      ) : iconOnly && option.icon && typeof option.label === 'string' ? (
        <Tooltip key={option.value} content={option.label}>
          <Tab {...previewEvents(option)} className="sd-segmented-icon" value={option.value} icon={option.icon} aria-label={option.label} title={option.label} disabled={option.disabled} />
        </Tooltip>
      ) : (
        <Tab {...previewEvents(option)} key={option.value} value={option.value} icon={option.icon} disabled={option.disabled}>{option.label}</Tab>
      ))}
    </TabList>
  );
}
