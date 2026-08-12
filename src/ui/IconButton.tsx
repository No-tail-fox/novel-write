import type { ReactElement } from 'react';
import { Button, type ButtonProps } from './Button';

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label' | 'children' | 'icon'> {
  label: string;
  icon: ReactElement;
}

export function IconButton({ label, icon, title = label, ...props }: IconButtonProps) {
  return <Button {...props} className={`sd-icon-button ${props.className ?? ''}`.trim()} aria-label={label} title={title} icon={icon} />;
}
