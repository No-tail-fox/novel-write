export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleField({ label, checked, onChange, disabled = false }: ToggleFieldProps) {
  return (
    <div className="draft-toggle-row">
      <span>{label}</span>
      <label className="draft-toggle-field draft-toggle-control">
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="draft-toggle-box" aria-hidden="true">{checked ? '✓' : ''}</span>
        <span>{checked ? '开启' : '关闭'}</span>
      </label>
    </div>
  );
}
