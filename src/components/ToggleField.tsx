import { CheckboxField } from '../ui';

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleField({ label, checked, onChange, disabled = false }: ToggleFieldProps) {
  return (
    <CheckboxField label={label} checked={checked} disabled={disabled} onChange={(_, data) => onChange(data.checked === true)} />
  );
}
