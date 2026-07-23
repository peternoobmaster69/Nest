import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useId } from "react";
import { Input, Select, Textarea } from "./controls";

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
};

function FieldShell({ label, hint, error, required, htmlFor, children }: FieldShellProps) {
  return (
    <div className={`form-group${error ? " has-error" : ""}`}>
      <label className="label" htmlFor={htmlFor}>
        {label}{required ? <span className="field-required" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <div className="form-hint" id={`${htmlFor}-hint`}>{hint}</div> : null}
      {error ? <div className="form-error" id={`${htmlFor}-error`} role="alert">{error}</div> : null}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
};

export function TextField({ label, hint, error, id, required, className = "", ...props }: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <Input
        id={fieldId}
        className={`input${error ? " is-error" : ""} ${className}`.trim()}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        {...props}
      />
    </FieldShell>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
};

export function SelectField({ label, hint, error, id, required, className = "", children, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <Select
        id={fieldId}
        className={`input${error ? " is-error" : ""} ${className}`.trim()}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      >
        {children}
      </Select>
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
};

export function TextAreaField({ label, hint, error, id, required, className = "", ...props }: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <Textarea
        id={fieldId}
        className={`input textarea${error ? " is-error" : ""} ${className}`.trim()}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      />
    </FieldShell>
  );
}
