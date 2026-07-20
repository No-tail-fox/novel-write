import { FormField } from './FormField';

export interface RangeFieldProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function RangeField({ label, min, max, step, value, onChange, disabled = false }: RangeFieldProps) {
  return (
    <FormField label={label} disabled={disabled}>
      <div className="draft-range-field">
        <input
          type="range"
          aria-label={`${label}滑块`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          aria-label={`${label}数值`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </FormField>
  );
}
