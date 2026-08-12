import { Checkbox as FluentCheckbox } from '@fluentui/react-components';
import type { ComponentProps } from 'react';
import { mergeStoryDreamClasses } from './utils';

export type CheckboxFieldProps = ComponentProps<typeof FluentCheckbox>;

export function CheckboxField({ className, ...props }: CheckboxFieldProps) {
  return <FluentCheckbox {...props} className={mergeStoryDreamClasses('sd-checkbox', className)} />;
}
