import { Field, Select as FluentSelect } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface SelectFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps extends Omit<ComponentProps<typeof FluentSelect>, 'children' | 'size'> {
  label: string | ReactElement;
  hint?: string | ReactElement;
  validationMessage?: string | ReactElement;
  options: readonly SelectFieldOption[];
  fieldClassName?: string;
}

export function SelectField({ label, hint, validationMessage, options, fieldClassName, className, ...props }: SelectFieldProps) {
  return (
    <Field className={mergeStoryDreamClasses('sd-field', fieldClassName)} label={label} hint={hint} validationMessage={validationMessage}>
      <FluentSelect {...props} className={mergeStoryDreamClasses('sd-select', className)} size="medium">
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </FluentSelect>
    </Field>
  );
}
