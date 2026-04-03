"use client";

import { InputHTMLAttributes } from "react";

type NumericCalculatorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  allowDecimal?: boolean;
};

function evaluateExpression(raw: string, allowDecimal: boolean) {
  const normalized = raw.replace(/\s+/g, "");
  const pattern = allowDecimal
    ? /^-?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)*$/
    : /^-?\d+(?:[+-]\d+)*$/;

  if (!pattern.test(normalized)) return null;

  const tokens = normalized.match(/[+-]?\d+(?:\.\d+)?/g);
  if (!tokens?.length) return null;

  const total = tokens.reduce((sum, token) => sum + Number(token), 0);
  if (!Number.isFinite(total)) return null;

  return allowDecimal
    ? String(Number(total.toFixed(2)))
    : String(Math.round(total));
}

export function NumericCalculatorInput({
  value,
  onValueChange,
  allowDecimal = true,
  className = "",
  disabled,
  ...inputProps
}: NumericCalculatorInputProps) {
  const rawValue = String(value ?? "");

  return (
    <div className="calc-input-wrap">
      <input
        {...inputProps}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        className={`input calc-input-field ${className}`.trim()}
        value={rawValue}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className="btn btn-ghost btn-icon calc-input-btn"
        disabled={disabled}
        title="Calculate expression"
        aria-label="Calculate expression"
        onClick={() => {
          const result = evaluateExpression(rawValue, allowDecimal);
          if (result !== null) onValueChange(result);
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <rect x="8" y="6" width="8" height="3" rx="0.8" fill="currentColor" opacity="0.85" />
          <circle cx="9" cy="12" r="1.1" fill="currentColor" />
          <circle cx="12" cy="12" r="1.1" fill="currentColor" />
          <circle cx="15" cy="12" r="1.1" fill="currentColor" />
          <circle cx="9" cy="16" r="1.1" fill="currentColor" />
          <circle cx="12" cy="16" r="1.1" fill="currentColor" />
          <circle cx="15" cy="16" r="1.1" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
