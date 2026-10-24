import { DrawerBody, DrawerHeader, DrawerHeaderTitle, OverlayDrawer } from '@fluentui/react-components';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';

export interface DrawerProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  position?: 'start' | 'end';
  mountNode?: HTMLElement | null;
  className?: string;
  id?: string;
}

/** Modal focus/escape handling lives in the shared UI layer. Drafts stay mounted. */
export function Drawer({ title, open, onOpenChange, children, position = 'end', mountNode, className = '', id }: DrawerProps) {
  const trigger = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      // OverlayDrawer has no DialogTrigger; restore its external opener ourselves.
      const opener = trigger.current;
      requestAnimationFrame(() => {
        if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      });
    };
  }, [open]);
  // Retained Fluent surfaces remain in the DOM after their exit motion. Hide both
  // slots explicitly so closed drafts cannot cover the workspace or receive input.
  const retainedStyle = open ? undefined : { display: 'none' };
  return <OverlayDrawer id={id} open={open} onOpenChange={(_, data) => onOpenChange(data.open)} position={position} size="medium" mountNode={mountNode ?? undefined} unmountOnClose={false} style={retainedStyle} backdrop={{ className: 'sd-drawer-backdrop', style: retainedStyle }} className={`sd-drawer ${className}`}>
    <DrawerHeader><DrawerHeaderTitle action={<IconButton label={`关闭${title}`} icon={<X size={16} />} variant="subtle" onClick={() => onOpenChange(false)} />}>{title}</DrawerHeaderTitle></DrawerHeader>
    <DrawerBody>{children}</DrawerBody>
  </OverlayDrawer>;
}
