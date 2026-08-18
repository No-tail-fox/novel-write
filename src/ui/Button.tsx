import { Button as FluentButton } from '@fluentui/react-components';
import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';
export type ControlDensity = 'compact' | 'comfortable' | 'spacious';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  density?: ControlDensity;
  icon?: ReactElement;
  iconPosition?: 'before' | 'after';
}

const appearances = {
  primary: 'primary',
  secondary: 'secondary',
  subtle: 'subtle',
  danger: 'primary',
} as const;

const sizes = {
  compact: 'small',
  comfortable: 'medium',
  spacious: 'large',
} as const;

export function Button({ variant = 'secondary', density = 'comfortable', className, children, icon, iconPosition = 'before', ...props }: ButtonProps) {
  return (
    <FluentButton
      {...props}
      appearance={appearances[variant]}
      size={sizes[density]}
      icon={icon}
      iconPosition={iconPosition}
      className={mergeStoryDreamClasses('sd-button', `sd-button--${variant}`, `sd-button--${density}`, className)}
    >
      {children !== undefined && children !== null ? <span className="sd-button__content">{children}</span> : null}
    </FluentButton>
  );
}
