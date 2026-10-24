import {
  Dialog as FluentDialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
} from '@fluentui/react-components';
import { useId, useLayoutEffect, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface DialogProps extends Omit<ComponentProps<typeof FluentDialog>, 'children' | 'onOpenChange'> {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  trigger?: ReactElement;
  onOpenChange?: (open: boolean) => void;
  surfaceClassName?: string;
}

export function Dialog({ title, children, actions, trigger, onOpenChange, surfaceClassName, ...props }: DialogProps) {
  const contentId = useId();
  useLayoutEffect(() => {
    if (trigger || !props.open) return;
    // Controlled dialogs opened outside DialogTrigger need an explicit return
    // target, including a nested catalog opened from an overlay drawer.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      requestAnimationFrame(() => {
        if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      });
    };
  }, [props.open, Boolean(trigger)]);
  const surface = (
    <DialogSurface className={mergeStoryDreamClasses('sd-dialog-surface', surfaceClassName)} aria-describedby={contentId}>
      <DialogBody>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent id={contentId}>{children}</DialogContent>
        {actions ? <DialogActions>{actions}</DialogActions> : null}
      </DialogBody>
    </DialogSurface>
  );
  const dialogProps = { ...props, onOpenChange: (_: unknown, data: { open: boolean }) => onOpenChange?.(data.open) };

  return trigger ? (
    <FluentDialog {...dialogProps}>
      <DialogTrigger disableButtonEnhancement>{trigger}</DialogTrigger>
      {surface}
    </FluentDialog>
  ) : (
    <FluentDialog {...props} onOpenChange={(_, data) => onOpenChange?.(data.open)}>
      {surface}
    </FluentDialog>
  );
}
