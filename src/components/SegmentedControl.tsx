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
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option}
            className={option === value ? 'selected' : ''}
            aria-pressed={option === value}
            disabled={disabled}
            onClick={() => onChange(option)}
            type="button"
          >
            {labels?.[index] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}
