import { SliderField, TextField } from '../ui';

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
  const normalizedValue = normalizeRangeValue(value, min, max);

  function commitValue(nextValue: number) {
    if (!Number.isFinite(nextValue)) return;
    onChange(normalizeRangeValue(nextValue, min, max));
  }

  return (
    <div className="sd-range-field">
      <SliderField
        label={label}
        aria-label={`${label}滑块`}
        min={min}
        max={max}
        step={step}
        value={normalizedValue}
        disabled={disabled}
        onChange={(_, data) => commitValue(data.value)}
      />
      <TextField
        label={`${label}数值`}
        fieldClassName="sd-range-number"
        type="number"
        aria-label={`${label}数值`}
        min={min}
        max={max}
        step={step}
        value={String(normalizedValue)}
        disabled={disabled}
        onChange={(event) => commitValue(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

export function normalizeRangeValue(value: number, min: number, max: number): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  if (!Number.isFinite(value)) return lower;
  return Math.min(upper, Math.max(lower, value));
}

export function rangeProgressPercent(value: number, min: number, max: number): number {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const span = upper - lower;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return ((normalizeRangeValue(value, lower, upper) - lower) / span) * 100;
}
