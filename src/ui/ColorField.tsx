import { TextField } from './TextField';

export interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  pickerValue?: string;
}

export function ColorField({ label, value, onChange, disabled, pickerValue }: ColorFieldProps) {
  const color = /^#[\da-f]{6}$/i.test(value) ? value : /^#[\da-f]{3}$/i.test(value)
    ? `#${value.slice(1).split('').map((part) => part + part).join('')}` : '#000000';
  return (
    <TextField
      label={label}
      value={value}
      spellCheck={false}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      contentBefore={
        <input className="sd-color-swatch" type="color" aria-label={`${label}取色`} value={pickerValue ?? color} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      }
    />
  );
}
