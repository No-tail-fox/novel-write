import { Field, Input as FluentInput } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface TextFieldProps extends Omit<ComponentProps<typeof FluentInput>, 'size'> {
  label: string | ReactElement;
  hint?: string | ReactElement;
  validationMessage?: string | ReactElement;
  fieldClassName?: string;
}

export function TextField({ label, hint, validationMessage, fieldClassName, className, ...props }: TextFieldProps) {
  return (
    <Field className={mergeStoryDreamClasses('sd-field', fieldClassName)} label={label} hint={hint} validationMessage={validationMessage}>
      <FluentInput {...props} className={mergeStoryDreamClasses('sd-input', className)} size="medium" />
    </Field>
  );
}
