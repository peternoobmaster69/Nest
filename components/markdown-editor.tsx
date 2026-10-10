"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Textarea } from "@/components/ui/controls";

type NotesInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minLines?: number;
  maxLines?: number;
  className?: string;
  calculator?: boolean;
};

function withoutGroupingCommas(input: string) {
  const parentheses: boolean[] = [];
  let functionDepth = 0;
  let result = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "(") {
      const functionCall = /[a-z]\s*$/i.test(input.slice(0, index));
      parentheses.push(functionCall);
      if (functionCall) functionDepth += 1;
    }
    if (char === ")" && parentheses.pop()) functionDepth -= 1;
    // Commas inside function calls separate arguments. Elsewhere they group digits.
    if (char === "," && functionDepth === 0) continue;
    result += char;
  }
  return result;
}

function normalizeCalculatorLine(line: string) {
  let normalized = line.trim();
  const colonIndex = normalized.indexOf(":");
  if (colonIndex >= 0) {
    normalized = normalized.slice(colonIndex + 1).trim();
  }

  normalized = normalized
    .replace(/[$€£¥]/g, "")
    .replace(/\s+/g, " ");

  return withoutGroupingCommas(normalized);
}

function isDigit(char: string) {
  return char >= "0" && char <= "9";
}

function parseCalculatorExpression(input: string): number {
  let index = 0;

  const skipWhitespace = () => {
    while (index < input.length && /\s/.test(input[index])) index += 1;
  };

  const parseNumber = () => {
    skipWhitespace();
    const start = index;
    let hasDigit = false;

    while (index < input.length && isDigit(input[index])) {
      hasDigit = true;
      index += 1;
    }

    if (input[index] === ".") {
      index += 1;
      while (index < input.length && isDigit(input[index])) {
        hasDigit = true;
        index += 1;
      }
    }

    if (!hasDigit) {
      throw new Error("Expected number");
    }

    return Number(input.slice(start, index));
  };

  const parseIdentifier = () => {
    skipWhitespace();
    const start = index;
    while (index < input.length && /[a-z]/i.test(input[index])) index += 1;
    return input.slice(start, index).toLowerCase();
  };

  const parseArguments = (): number[] => {
    skipWhitespace();
    if (input[index] === ")") return [];
    const args = [parseExpression()];
    while (true) {
      skipWhitespace();
      if (input[index] !== ",") break;
      index += 1;
      args.push(parseExpression());
    }
    return args;
  };

  const parseFunction = (): number => {
    const identifier = parseIdentifier();
    skipWhitespace();
    if (input[index] !== "(") throw new Error("Expected function call");
    index += 1;
    const args = parseArguments();
    skipWhitespace();
    if (input[index] !== ")") throw new Error("Expected closing parenthesis");
    index += 1;
    if (identifier === "sum") return args.reduce((total, value) => total + value, 0);
    throw new Error("Unsupported function");
  };

  const parsePrimary = (): number => {
    skipWhitespace();
    const char = input[index];

    if (char === "(") {
      index += 1;
      const value = parseExpression();
      skipWhitespace();
      if (input[index] !== ")") {
        throw new Error("Expected closing parenthesis");
      }
      index += 1;
      return value;
    }

    if (/[a-z]/i.test(char ?? "")) {
      return parseFunction();
    }

    return parseNumber();
  };

  const parseUnary = (): number => {
    skipWhitespace();
    if (input[index] === "+") {
      index += 1;
      return parseUnary();
    }
    if (input[index] === "-") {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    while (true) {
      skipWhitespace();
      const operator = input[index];
      if (operator !== "*" && operator !== "/") break;
      index += 1;
      const nextValue = parseUnary();
      value = operator === "*" ? value * nextValue : value / nextValue;
    }
    return value;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (true) {
      skipWhitespace();
      const operator = input[index];
      if (operator !== "+" && operator !== "-") break;
      index += 1;
      const nextValue = parseTerm();
      value = operator === "+" ? value + nextValue : value - nextValue;
    }
    return value;
  };

  const value = parseExpression();
  skipWhitespace();
  if (index !== input.length) {
    throw new Error("Unexpected input");
  }
  return value;
}

function getCalculatorTotal(value: string) {
  const lines = value
    .split("\n")
    .map((line) => normalizeCalculatorLine(line))
    .filter(Boolean);

  if (lines.length === 0) return null;

  try {
    const total = parseCalculatorExpression(lines.at(-1)!);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  placeholder = "Add notes...",
  minLines = 2,
  maxLines = 15,
  className,
  calculator = false,
}: Readonly<NotesInputProps>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const calculatorTotal = useMemo(
    () => (calculator ? getCalculatorTotal(value) : null),
    [calculator, value],
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current!;

    textarea.style.height = "auto";
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 19.5;
    const borderHeight =
      (Number.parseFloat(styles.borderTopWidth) || 0) +
      (Number.parseFloat(styles.borderBottomWidth) || 0) +
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const minHeight = lineHeight * minLines + borderHeight;
    const maxHeight = lineHeight * maxLines + borderHeight;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, minLines, maxLines]);

  return (
    <label className={className} style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span>{label}</span>
        {calculatorTotal !== null ? (
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
            = {calculatorTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        ) : null}
      </span>
      <Textarea
        ref={textareaRef}
        className="input"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          lineHeight: "1.5",
          resize: "none",
        }}
        rows={minLines}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
