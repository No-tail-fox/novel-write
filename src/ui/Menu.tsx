import {
  Menu as FluentMenu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';

export interface MenuOption {
  id: string;
  label: string | ReactElement;
  icon?: ReactElement;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps extends Omit<ComponentProps<typeof FluentMenu>, 'children'> {
  trigger: ReactElement;
  options: readonly MenuOption[];
}

export function Menu({ trigger, options, ...props }: MenuProps) {
  return (
    <FluentMenu {...props}>
      <MenuTrigger disableButtonEnhancement>{trigger}</MenuTrigger>
      <MenuPopover className="sd-menu-popover">
        <MenuList>
          {options.map((option) => (
            <MenuItem key={option.id} icon={option.icon} disabled={option.disabled} onClick={option.onSelect}>
              {option.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </FluentMenu>
  );
}
