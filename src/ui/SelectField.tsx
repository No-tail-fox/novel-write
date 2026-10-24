import { Field, Select as FluentSelect } from '@fluentui/react-components';
import type { ComponentProps, CSSProperties, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface SelectFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
  style?: CSSProperties;
}

export interface SelectFieldProps extends Omit<ComponentProps<typeof FluentSelect>, 'children' | 'size'> {
  label: string | ReactElement;
  hint?: string | ReactElement;
  validationMessage?: string | ReactElement;
  options: readonly SelectFieldOption[];
  fieldClassName?: string;
}

export function SelectField({ label, hint, validationMessage, options, fieldClassName, className, ...props }: SelectFieldProps) {
  const groups = new Map<string, SelectFieldOption[]>();
  for (const option of options) {
    const group = option.group ?? '';
    groups.set(group, [...(groups.get(group) ?? []), option]);
  }
  const renderOption = (option: SelectFieldOption) => (
    <option key={option.value} value={option.value} disabled={option.disabled} style={option.style}>{option.label}</option>
  );
  return (
    <Field className={mergeStoryDreamClasses('sd-field', fieldClassName)} label={label} hint={hint} validationMessage={validationMessage}>
      <FluentSelect {...props} className={mergeStoryDreamClasses('sd-select', className)} size="medium">
        {[...groups].map(([group, items]) => group
          ? <optgroup key={group} label={group}>{items.map(renderOption)}</optgroup>
          : items.map(renderOption))}
      </FluentSelect>
    </Field>
  );
}
