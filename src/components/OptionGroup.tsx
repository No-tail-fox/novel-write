export interface OptionGroupProps<T extends string> {
  title: string;
  options: readonly (readonly [T, string, string?])[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function OptionGroup<T extends string>({ title, options, value, onChange, disabled = false }: OptionGroupProps<T>) {
  return (
    <div>
      <span className="field-title">{title}</span>
      <div className="option-cloud" role="group" aria-label={title}>
        {options.map(([id, label, hint]) => (
          <button
            key={id}
            className={value === id ? 'option-pill active' : 'option-pill'}
            aria-pressed={value === id}
            disabled={disabled}
            onClick={() => onChange(id)}
            type="button"
          >
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
