function amountTone(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

export function CreditTransactionSummary({
  total,
  receivableTotal,
  defaultSubaccountName,
  defaultSubaccountBalance,
  shortfall,
  formatCurrency,
}: Readonly<{
  total: number;
  receivableTotal: number;
  defaultSubaccountName: string;
  defaultSubaccountBalance: number;
  shortfall: number;
  formatCurrency: (value: number) => string;
}>) {
  return (
    <div className="cct-summary">
      <div className="cct-summary-left">
        <div className="cct-summary-item">
          <span className="cct-summary-label">Total Amount</span>
          <span className={`cct-summary-value ${amountTone(total)}`}>{formatCurrency(total)}</span>
        </div>
        <div className="cct-summary-group">
          <div className="cct-summary-item">
            <span className="cct-summary-label">Total Receivable</span>
            <span className="cct-summary-value">{formatCurrency(receivableTotal)}</span>
          </div>
          <div className="cct-summary-item">
            <span className="cct-summary-label">{defaultSubaccountName}</span>
            <span className={`cct-summary-value ${amountTone(defaultSubaccountBalance)}`}>{formatCurrency(defaultSubaccountBalance)}</span>
          </div>
        </div>
      </div>
      {shortfall > 0 ? (
        <div className="cct-summary-right">
          <div className="cct-summary-item cct-summary-deficit">
            <span className="cct-summary-label">Shortfall</span>
            <span className={`cct-summary-value ${amountTone(shortfall)}`}>{formatCurrency(shortfall)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
