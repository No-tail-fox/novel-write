import {
  Dialog as FluentDialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
} from '@fluentui/react-components';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

export interface DialogProps extends Omit<ComponentProps<typeof FluentDialog>, 'children' | 'onOpenChange'> {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  trigger?: ReactElement;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({ title, children, actions, trigger, onOpenChange, ...props }: DialogProps) {
  const surface = (
    <DialogSurface className="sd-dialog-surface">
      <DialogBody>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>{children}</DialogContent>
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
