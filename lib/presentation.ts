import { formatMoney, normalizeCurrency } from "@/lib/currency";

export function formatSignedMoney(cents: number, currency?: string | null) {
  const absolute = formatMoney(Math.abs(cents), normalizeCurrency(currency));
  if (cents > 0) return `+${absolute}`;
  if (cents < 0) return `−${absolute}`;
  return absolute;
}

export function formatCurrencyAmount(amount: number, currency?: string | null) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: normalizeCurrency(currency),
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatLocalDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-SG", options || { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatLocalDateTime(value: Date | string | number) {
  return formatLocalDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function amountTone(cents: number) {
  if (cents > 0) return "positive";
  if (cents < 0) return "negative";
  return "zero";
}
