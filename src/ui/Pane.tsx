import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface PaneProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'aside' | 'section';
  tone?: 'base' | 'subtle' | 'raised';
  children: ReactNode;
}

export function Pane({ as = 'section', tone = 'base', className, children, ...props }: PaneProps) {
  return createElement(
    as,
    { ...props, className: mergeStoryDreamClasses('sd-pane', `sd-pane--${tone}`, className) },
    children,
  );
}
