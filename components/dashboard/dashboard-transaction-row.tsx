import { memo } from "react";

function transactionEmoji(subject: string) {
  const value = subject.toLowerCase();
  if (value.includes("salary") || value.includes("payroll")) return "💰";
  if (value.includes("food") || value.includes("restaurant")) return "🍜";
  if (value.includes("transport") || value.includes("taxi")) return "🚕";
  if (value.includes("shop")) return "🛍️";
  return "🧾";
}

export const DashboardTransactionRow = memo(function DashboardTransactionRow({
  tx,
  showBudgetIcon,
  budgetIcon,
  budgetName,
  amountClassName,
  amountPrefix,
  formattedAmount,
  formattedDate,
}: {
  tx: { subject: string };
  showBudgetIcon: boolean;
  budgetIcon: string | null;
  budgetName: string;
  amountClassName: string;
  amountPrefix: string;
  formattedAmount: string;
  formattedDate: string;
}) {
  return (
    <div className="tx-item">
      <div className="tx-icon">{transactionEmoji(tx.subject)}</div>
      <div className="tx-meta dashboard-recent-meta">
        <div className="tx-name dashboard-recent-name">
          {showBudgetIcon && budgetIcon ? <span aria-hidden="true">{budgetIcon}</span> : null}
          <span>{tx.subject}</span>
        </div>
        <div className="tx-date">{formattedDate} · {budgetName}</div>
      </div>
      <div className={`tx-amount ${amountClassName}`}>{amountPrefix}{formattedAmount}</div>
    </div>
  );
});
