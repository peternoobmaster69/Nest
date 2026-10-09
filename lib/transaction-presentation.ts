export function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

export function formatTransactionDate(dateString: string): string {
  const date = new Date(dateString);
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  // Hide time if time is midnight (00:00:00) or top of any hour (XX:00:00)
  if (minutes === 0 && seconds === 0) {
    return date.toLocaleDateString();
  }
  return date.toLocaleString();
}

const transactionGroupMonthYearFormatter = new Intl.DateTimeFormat("en-SG", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatTransactionGroupDateRange(firstDateString?: string | null, lastDateString?: string | null): string {
  if (!firstDateString || !lastDateString) return "No transaction dates";

  const firstDate = new Date(firstDateString);
  const lastDate = new Date(lastDateString);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return "No transaction dates";

  const firstLabel = transactionGroupMonthYearFormatter.format(firstDate);
  const lastLabel = transactionGroupMonthYearFormatter.format(lastDate);
  const isSameMonth =
    firstDate.getUTCFullYear() === lastDate.getUTCFullYear() && firstDate.getUTCMonth() === lastDate.getUTCMonth();

  return isSameMonth ? firstLabel : `${firstLabel} – ${lastLabel}`;
}

export function normalizeTransactionGroupSearchValue(value: string): string {
  return value.toLocaleLowerCase().replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
}

type MonthTransaction = { date: string; direction: "CREDIT" | "DEBIT"; amountCents: number };
type TransactionsByMonth<T> = { monthKey: string; monthLabel: string; transactions: T[]; totalIncome: number; totalExpense: number };

export function groupTransactionsByMonth<T extends MonthTransaction>(transactions: readonly T[]): TransactionsByMonth<T>[] {
  const groups = new Map<string, TransactionsByMonth<T>>();
  for (const transaction of transactions) {
    const date = new Date(transaction.date);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    let group = groups.get(monthKey);
    if (!group) {
      group = {
        monthKey,
        monthLabel: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
        transactions: [], totalIncome: 0, totalExpense: 0,
      };
      groups.set(monthKey, group);
    }
    group.transactions.push(transaction);
    if (transaction.direction === "CREDIT") group.totalIncome += transaction.amountCents;
    else group.totalExpense += transaction.amountCents;
  }
  return Array.from(groups.values()).sort((left, right) => right.monthKey.localeCompare(left.monthKey));
}

export function getBudgetIcon(name: string, icon?: string | null) {
  if (icon) return icon;
  const key = name.toLowerCase();
  if (key.includes("save")) return "🛡️";
  if (key.includes("loan")) return "🏠";
  if (key.includes("insurance")) return "🧾";
  if (key.includes("phone")) return "📱";
  if (key.includes("credit")) return "💳";
  return "💰";
}

export function getContextualGroupDefaults(budget: { name: string; icon?: string | null } | undefined, transactions: readonly { date: string }[], now = new Date()) {
  const name = budget?.name ?? "Transactions";
  const key = name.toLocaleLowerCase();
  const contexts = [
    { match: /holiday|travel|vacation|trip/, icon: "🧳", example: "Japan trip" },
    { match: /home|house|renovation|repair/, icon: "🛠️", example: "Kitchen renovation" },
    { match: /health|medical|hospital|insurance/, icon: "🏥", example: "Insurance claim" },
    { match: /car|vehicle|transport/, icon: "🚗", example: "Major service" },
    { match: /gift|family|birthday/, icon: "🎁", example: "Mum's birthday" },
    { match: /school|education|course/, icon: "🎓", example: "Design course" },
    { match: /work|business|project/, icon: "💼", example: "Client project" },
    { match: /wedding/, icon: "💍", example: "Wedding expenses" },
  ];
  const context = contexts.find((item) => item.match.test(key));
  const dates = transactions.map((transaction) => new Date(transaction.date)).filter((date) => !Number.isNaN(date.getTime()));
  const latestDate = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : now;
  const period = latestDate.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return { icon: context?.icon ?? budget?.icon ?? "📌", suggestedName: `${name} · ${period}`, placeholder: `e.g. ${context?.example ?? "Annual renewal"}` };
}
