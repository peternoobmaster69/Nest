function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function utcDate(year: number, monthIndex: number, day: number) {
  const clampedDay = Math.min(day, daysInUtcMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, clampedDay, 0, 0, 0));
}

function addUtcMonths(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const nextYear = year + Math.floor(monthIndex / 12);
  const nextMonthIndex = ((monthIndex % 12) + 12) % 12;
  return utcDate(nextYear, nextMonthIndex, date.getUTCDate());
}

export function deriveStatementCycle(params: {
  transactionDate: Date;
  statementDay: number;
  paymentDueDay: number;
}) {
  const { transactionDate, statementDay, paymentDueDay } = params;

  const txnYear = transactionDate.getUTCFullYear();
  const txnMonthIndex = transactionDate.getUTCMonth();
  const txnDay = transactionDate.getUTCDate();

  const statementClosingDate =
    txnDay <= statementDay
      ? utcDate(txnYear, txnMonthIndex, statementDay)
      : utcDate(
          txnMonthIndex === 11 ? txnYear + 1 : txnYear,
          (txnMonthIndex + 1) % 12,
          statementDay,
        );

  const dueBaseDate =
    paymentDueDay > statementDay
      ? statementClosingDate
      : addUtcMonths(statementClosingDate, 1);

  const paymentDueDate = utcDate(
    dueBaseDate.getUTCFullYear(),
    dueBaseDate.getUTCMonth(),
    paymentDueDay,
  );

  return {
    statementMonth: statementClosingDate.getUTCMonth() + 1,
    statementYear: statementClosingDate.getUTCFullYear(),
    paymentDueDate,
  };
}
