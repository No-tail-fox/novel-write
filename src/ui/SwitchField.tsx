import { Switch as FluentSwitch } from '@fluentui/react-components';
import type { ComponentProps } from 'react';
import { mergeStoryDreamClasses } from './utils';

export type SwitchFieldProps = ComponentProps<typeof FluentSwitch>;

export function SwitchField({ className, ...props }: SwitchFieldProps) {
  return <FluentSwitch {...props} className={mergeStoryDreamClasses('sd-switch', className)} />;
}
