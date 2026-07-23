"use client";

import { InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";

type NumericCalculatorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  allowDecimal?: boolean;
};

type ParsedExpression = {
  numbers: number[];
  operators: string[];
  binaryOperatorCount: number;
};

function parseNumber(normalized: string, startIndex: number, allowDecimal: boolean) {
  let index = startIndex;
  let hasDigit = false;
  let hasDecimal = false;

  while (index < normalized.length) {
    const char = normalized[index];

    if (char >= "0" && char <= "9") {
      hasDigit = true;
      index += 1;
      continue;
    }

    if (char === "." && allowDecimal && !hasDecimal) {
      hasDecimal = true;
      index += 1;
      continue;
    }

    break;
  }

  if (!hasDigit) return null;

  const rawNumber = normalized.slice(startIndex, index);
  if (rawNumber.endsWith(".")) return null;

  const value = Number(rawNumber);
  if (!Number.isFinite(value)) return null;

  return { value, nextIndex: index };
}

function parseExpression(raw: string, allowDecimal: boolean): ParsedExpression | null {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) return null;

  const numbers: number[] = [];
  const operators: string[] = [];
  let binaryOperatorCount = 0;
  let index = 0;
  let expectNumber = true;

  while (index < normalized.length) {
    const char = normalized[index];

    if (expectNumber) {
      const sign = char === "-" || char === "+" ? char : "";
      const numberStart = sign ? index + 1 : index;
      const parsed = parseNumber(normalized, numberStart, allowDecimal);
      if (!parsed) return null;

      numbers.push(sign === "-" ? -parsed.value : parsed.value);
      index = parsed.nextIndex;
      expectNumber = false;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      operators.push(char);
      binaryOperatorCount += 1;
      index += 1;
      expectNumber = true;
      continue;
    }

    return null;
  }

  if (expectNumber || numbers.length === 0 || binaryOperatorCount === 0) return null;

  return { numbers, operators, binaryOperatorCount };
}

function calculateParsedExpression({ numbers, operators }: ParsedExpression) {
  const collapsedNumbers = [numbers[0]];
  const collapsedOperators: string[] = [];

  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const nextNumber = numbers[index + 1];

    if (operator === "*") {
      collapsedNumbers[collapsedNumbers.length - 1] *= nextNumber;
    } else if (operator === "/") {
      if (nextNumber === 0) return null;
      collapsedNumbers[collapsedNumbers.length - 1] /= nextNumber;
    } else {
      collapsedOperators.push(operator);
      collapsedNumbers.push(nextNumber);
    }
  }

  const total = collapsedOperators.reduce((sum, operator, index) => {
    const nextNumber = collapsedNumbers[index + 1];
    return operator === "+" ? sum + nextNumber : sum - nextNumber;
  }, collapsedNumbers[0]);

  return Number.isFinite(total) ? total : null;
}

function evaluateExpression(raw: string, allowDecimal: boolean) {
  const parsed = parseExpression(raw, allowDecimal);
  if (!parsed) return null;

  const total = calculateParsedExpression(parsed);
  if (total === null) return null;

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
  const calculationResult = evaluateExpression(rawValue, allowDecimal);
  const canCalculate = calculationResult !== null;

  return (
    <div className="calc-input-wrap">
      <Input
        {...inputProps}
        type="text"
        inputMode={allowDecimal ? "text" : "numeric"}
        className={`input calc-input-field ${canCalculate ? "calc-input-field-with-button" : ""} ${className}`.trim()}
        value={rawValue}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
      />
      {canCalculate ? (
        <Button
          type="button"
          className="btn btn-ghost btn-icon calc-input-btn"
          disabled={disabled}
          title="Calculate expression"
          aria-label="Calculate expression"
          onClick={() => onValueChange(calculationResult)}
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
        </Button>
      ) : null}
    </div>
  );
}
