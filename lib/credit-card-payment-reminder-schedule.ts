export const REMINDER_LEAD_DAYS = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function getDaysUntilDue(dueDate: Date, today: Date) {
  return Math.round((startOfUtcDay(dueDate).getTime() - startOfUtcDay(today).getTime()) / MS_PER_DAY);
}

export function shouldSendPaymentReminder(daysUntilDue: number) {
  return daysUntilDue === 5 || daysUntilDue === 3 || daysUntilDue === 1 || daysUntilDue <= 0;
}

export function shouldShowPaymentReminder(daysUntilDue: number) {
  return daysUntilDue <= REMINDER_LEAD_DAYS;
}

export function getReminderDateKey(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}
