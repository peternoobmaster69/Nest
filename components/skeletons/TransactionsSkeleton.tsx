import { Skeleton } from "@/components/ui/Skeleton";
import { BankSelectorSkeleton } from "@/components/skeletons/BankSelectorSkeleton";

const MONTH_PLACEHOLDERS = [
  { id: "current", labelWidth: 96, rowCount: 4 },
  { id: "previous", labelWidth: 118, rowCount: 3 },
];
const ROW_PLACEHOLDERS = [
  { id: "latest", titleWidth: "54%", labelWidth: 72, dateWidth: 86 },
  { id: "previous", titleWidth: "72%", labelWidth: 86, dateWidth: 112 },
  { id: "earlier", titleWidth: "54%", labelWidth: 72, dateWidth: 86 },
  { id: "oldest", titleWidth: "72%", labelWidth: 86, dateWidth: 112 },
];

export function TransactionsInitialSkeleton() {
  return (
    <>
      <TransactionsBankSelectorSkeleton />
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <Skeleton width={112} height={16} borderRadius="4px" />
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Skeleton width={172} height={15} borderRadius="4px" />
            <Skeleton width={26} height={26} borderRadius="6px" />
          </div>
        </div>
        <TransactionsAccountGridSkeleton />
      </section>
      <TransactionsFilterBarSkeleton />
      <section className="card">
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
          <TransactionsStatsSkeleton />
        </div>
        <div className="simple-list tx-month-groups">
          <TransactionsListSkeleton />
        </div>
      </section>
    </>
  );
}

function TransactionsBankSelectorSkeleton() {
  return <BankSelectorSkeleton />;
}

function TransactionsAccountGridSkeleton() {
  return (
    <div className="account-cards-grid tx-account-grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          className="budget-mini budget-mini-compact tx-account-card"
          key={index}
          style={index === 0 ? { borderColor: "var(--brand-500)", boxShadow: "var(--shadow-sm)" } : { position: "relative" }}
        >
          <div className="tx-account-card-body">
            <div
              className="bm-name"
              style={index === 0 ? { display: "inline-flex", alignItems: "center", gap: "6px" } : { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "4px" }}
            >
              {index === 0 ? <Skeleton width={14} height={14} borderRadius="4px" /> : null}
              <Skeleton width={index === 0 ? 78 : 74} height={13} borderRadius="4px" />
              {index === 0 ? null : <Skeleton width={18} height={18} borderRadius="6px" />}
            </div>
            <div className="bm-amount">
              <Skeleton width={88} height={17} borderRadius="4px" />
            </div>
            <div className="bm-target tx-account-card-footer">
              <Skeleton width={index % 3 === 1 ? 62 : 16} height={10} borderRadius="4px" />
            </div>
          </div>
          {index === 0 ? null : (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: "2px",
                right: "4px",
                opacity: 0.2,
                pointerEvents: "none",
              }}
            >
              <Skeleton width={28} height={28} borderRadius="999px" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function TransactionsFilterBarSkeleton() {
  return (
    <div className="tx-filter-bar">
      <div className="tx-filter-controls">
        <div className="tx-filter-pills">
          <Skeleton width={58} height={31} borderRadius="var(--r-pill)" />
          <Skeleton width={58} height={31} borderRadius="var(--r-pill)" />
          <Skeleton width={48} height={31} borderRadius="var(--r-pill)" />
          <Skeleton width={86} height={31} borderRadius="var(--r-pill)" />
        </div>
        <div className="tx-primary-actions" aria-hidden="true">
          <Skeleton width={36} height={36} borderRadius="var(--r-sm)" />
          <Skeleton width={36} height={36} borderRadius="var(--r-sm)" />
        </div>
      </div>
      <div className="tx-search-box">
        <Skeleton width="100%" height={32} borderRadius="var(--r-pill)" />
      </div>
    </div>
  );
}

export function TransactionsStatsSkeleton() {
  return (
    <div className="transaction-stats-row">
      <span className="period-label-desktop">
        <Skeleton width={78} height={16} borderRadius="4px" />
      </span>
      <div className="transaction-stats-summary">
        <Skeleton width={82} height={16} borderRadius="4px" />
        <Skeleton width={7} height={16} borderRadius="4px" />
        <Skeleton width={82} height={16} borderRadius="4px" />
        <Skeleton width={9} height={16} borderRadius="4px" />
        <Skeleton width={86} height={16} borderRadius="4px" />
      </div>
    </div>
  );
}

export function TransactionsListSkeleton() {
  return (
    <>
      {MONTH_PLACEHOLDERS.map((month) => (
        <div className="tx-month-group" key={month.id}>
          <div className="tx-month-header">
            <span className="tx-month-label">
              <Skeleton width={month.labelWidth} height={12} borderRadius="4px" />
            </span>
            <div className="tx-month-summary">
              <Skeleton width={78} height={18} borderRadius="4px" />
              <Skeleton width={82} height={18} borderRadius="4px" />
            </div>
          </div>
          <div className="tx-month-list">
            {ROW_PLACEHOLDERS.slice(0, month.rowCount).map((row) => (
              <div className="crud-row tx-recent-row" key={row.id}>
                <Skeleton width={32} height={32} borderRadius="8px" />
                <div className="tx-recent-main">
                  <Skeleton width={row.titleWidth} height={17} borderRadius="4px" />
                  <Skeleton width={row.labelWidth} height={18} borderRadius="4px" />
                  <span className="tx-recent-date">
                    <Skeleton width={row.dateWidth} height={13} borderRadius="4px" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function TransactionsReceivablesListSkeleton() {
  return (
    <div className="simple-list">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="crud-row" key={index}>
          <div style={{ display: "grid", gap: "5px", minWidth: 0 }}>
            <Skeleton width={index === 1 ? 154 : 118} height={17} borderRadius="4px" />
            <Skeleton width={96} height={13} borderRadius="4px" />
          </div>
          <Skeleton width={76} height={17} borderRadius="4px" />
        </div>
      ))}
    </div>
  );
}
