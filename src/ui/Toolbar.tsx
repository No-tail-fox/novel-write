import { Toolbar as FluentToolbar } from '@fluentui/react-components';
import type { ComponentProps } from 'react';
import { mergeStoryDreamClasses } from './utils';

export type ToolbarProps = ComponentProps<typeof FluentToolbar>;

export function Toolbar({ className, ...props }: ToolbarProps) {
  return <FluentToolbar {...props} className={mergeStoryDreamClasses('sd-toolbar', className)} />;
}
