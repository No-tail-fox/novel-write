import { Tooltip as FluentTooltip } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';

export interface TooltipProps extends Omit<ComponentProps<typeof FluentTooltip>, 'children' | 'content' | 'relationship'> {
  content: NonNullable<ComponentProps<typeof FluentTooltip>['content']>;
  relationship?: ComponentProps<typeof FluentTooltip>['relationship'];
  children: ReactElement;
}

export function Tooltip({ content, relationship = 'label', children, ...props }: TooltipProps) {
  return <FluentTooltip {...props} content={content} relationship={relationship}>{children}</FluentTooltip>;
}
