import { Field, Textarea as FluentTextarea } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface TextAreaFieldProps extends Omit<ComponentProps<typeof FluentTextarea>, 'size'> {
  label: string | ReactElement;
  hint?: string | ReactElement;
  validationMessage?: string | ReactElement;
  fieldClassName?: string;
}

export function TextAreaField({ label, hint, validationMessage, fieldClassName, className, ...props }: TextAreaFieldProps) {
  return (
    <Field className={mergeStoryDreamClasses('sd-field', fieldClassName)} label={label} hint={hint} validationMessage={validationMessage}>
      <FluentTextarea {...props} className={mergeStoryDreamClasses('sd-textarea', className)} size="medium" />
    </Field>
  );
}
