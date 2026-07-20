import type { ReactNode } from 'react';

export interface FormFieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
  disabled?: boolean;
}

export function FormField({ label, hint, children, disabled = false }: FormFieldProps) {
  return (
    <fieldset className="field form-field" disabled={disabled}>
      <legend className="form-field-label">{label}{hint ? <small>{hint}</small> : null}</legend>
      {children}
    </fieldset>
  );
}
