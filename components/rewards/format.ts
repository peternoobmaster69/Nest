export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export function hotelPointValueCents(points: number, centsPerPoint: number): number {
  return Math.round(points * centsPerPoint);
}

export function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

export function todayDateInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function calculateExpiryDateInputValue(dateValue: string, years: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const expiryDate = new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth() + 1, 0));
  return expiryDate.toISOString().slice(0, 10);
}

export function isExpiredAtToday(dateValue: string | null): boolean {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date < today;
}
