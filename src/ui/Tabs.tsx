import { Tab, TabList } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface TabItem {
  value: string;
  label: string | ReactElement;
  icon?: ReactElement;
  disabled?: boolean;
  id?: string;
  controls?: string;
}

export interface TabsProps extends Omit<ComponentProps<typeof TabList>, 'children' | 'onChange' | 'onTabSelect' | 'selectedValue'> {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
}

export function Tabs({ label, items, value, onChange, className, ...props }: TabsProps) {
  return (
    <TabList
      {...props}
      aria-label={label}
      className={mergeStoryDreamClasses('sd-tabs', className)}
      selectedValue={value}
      onTabSelect={(_, data) => onChange(String(data.value))}
    >
      {items.map((item) => (
        <Tab key={item.value} id={item.id} aria-controls={item.controls} value={item.value} data-tab-value={item.value} icon={item.icon} disabled={item.disabled}>{item.label}</Tab>
      ))}
    </TabList>
  );
}
