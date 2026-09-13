import { Tab, TabList } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';
import { Tooltip } from './Tooltip';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string | ReactElement;
  icon?: ReactElement;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> extends Omit<ComponentProps<typeof TabList>, 'children' | 'onChange' | 'onTabSelect' | 'selectedValue'> {
  label: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, className, iconOnly = false, ...props }: SegmentedControlProps<T>) {
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
      {options.map((option) => iconOnly && option.icon && typeof option.label === 'string' ? (
        <Tooltip key={option.value} content={option.label}>
          <Tab className="sd-segmented-icon" value={option.value} icon={option.icon} aria-label={option.label} title={option.label} disabled={option.disabled} />
        </Tooltip>
      ) : (
        <Tab key={option.value} value={option.value} icon={option.icon} disabled={option.disabled}>{option.label}</Tab>
      ))}
    </TabList>
  );
}
