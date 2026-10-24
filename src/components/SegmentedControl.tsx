import { SegmentedControl as FluentSegmentedControl } from '../ui';

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  labels?: readonly string[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <div className="field">
      {label ? <span>{label}</span> : null}
      <FluentSegmentedControl
        label={label}
        value={value}
        options={options.map((option, index) => ({ value: option, label: labels?.[index] ?? option, disabled }))}
        onChange={onChange}
      />
    </div>
  );
}
