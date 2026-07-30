import { formatMoney } from "@/lib/currency";

export function formatCioMoney(cents: number | null | undefined, currency: string) {
  return cents == null ? "Not set" : formatMoney(cents, currency);
}

export function formatCioPercent(bps: number | null | undefined) {
  if (bps == null) return "Not set";
  return `${(bps / 100).toLocaleString("en-SG", { maximumFractionDigits: 2 })}%`;
}

export function formatCioLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatCioDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function toIsoDate(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

export function moneyInputFromCents(value: number | null | undefined) {
  return value == null ? "" : String(value / 100);
}

export function centsFromMoneyInput(value: string, nullable = false) {
  if (!value.trim()) return nullable ? null : 0;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return nullable ? null : 0;
  return Math.round(amount * 100);
}

export function percentInputFromBps(value: number | null | undefined) {
  return value == null ? "" : String(value / 100);
}

export function bpsFromPercentInput(value: string, nullable = false) {
  if (!value.trim()) return nullable ? null : 0;
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return nullable ? null : 0;
  return Math.round(percentage * 100);
}
