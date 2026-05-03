import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Transactions page initial data regions
Route: /transactions
Layout regions: PageFrame sidebar/topbar are static chrome; .txn-page body is a grid with 14px gap.
Content blocks:
- Bank selector: .bank-selector-row, 10px 12px padding, 44x24 logo, 15px amount, 22px action buttons.
- Action row: flex row, gap 10px, two .btn elements at flex:1 with 40px control height.
- Sub-accounts card: .card with header flex, optional totals text, .account-cards-grid.tx-account-grid repeating .budget-mini.budget-mini-compact cards, min-height 68px.
- Recent transactions card: .card with static heading/count, .simple-list of .crud-row rows.
Do not skeletonize: PageFrame chrome, static button labels when parent data is already available, section headings.
*/
export function TransactionsInitialSkeleton() {
  return (
    <>
      <TransactionsBankSelectorSkeleton />
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
        <Skeleton width="100%" height={40} borderRadius="var(--r-md)" />
        <Skeleton width="100%" height={40} borderRadius="var(--r-md)" />
      </div>
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
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600 }}>Recent Transactions</div>
          <Skeleton width={42} height={15} borderRadius="4px" />
        </div>
        <TransactionsListSkeleton />
      </section>
    </>
  );
}

/*
Structural inventory: Transactions bank selector
Matches .bank-selector-summary loaded DOM and element sizes: 44x24 logo, amount line, 22px action buttons.
*/
export function TransactionsBankSelectorSkeleton() {
  return (
    <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
      <div className="bank-selector-summary">
        <div className="bank-selector-main">
          <Skeleton width={44} height={24} borderRadius="4px" />
          <Skeleton width={132} height={18} borderRadius="4px" />
        </div>
        <div className="bank-selector-actions">
          <Skeleton width={22} height={22} borderRadius="6px" />
          <Skeleton width={22} height={22} borderRadius="6px" />
        </div>
      </div>
    </div>
  );
}

/*
Structural inventory: Transactions sub-account grid
Repeats loaded .budget-mini.budget-mini-compact.tx-account-card cards; each has 12px label, 16px amount, 9px footer line.
*/
export function TransactionsAccountGridSkeleton() {
  return (
    <div className="account-cards-grid tx-account-grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="budget-mini budget-mini-compact tx-account-card" key={index}>
          <div className="tx-account-card-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "4px" }}>
              <Skeleton width={index === 0 ? 92 : 74} height={15} borderRadius="4px" />
              {index === 0 ? null : <Skeleton width={18} height={18} borderRadius="6px" />}
            </div>
            <Skeleton width={88} height={19} borderRadius="4px" />
            <Skeleton width={54} height={11} borderRadius="4px" />
          </div>
        </div>
      ))}
    </div>
  );
}

/*
Structural inventory: Transactions recent transaction rows
Maps to .simple-list > .crud-row.tx-recent-row: row padding 12px 14px, 12px gap, left copy stack, right amount/action affordance.
*/
export function TransactionsListSkeleton() {
  return (
    <div className="simple-list">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="crud-row tx-recent-row" key={index}>
          <div style={{ display: "grid", gap: "5px", minWidth: 0 }}>
            <Skeleton width={index % 2 ? 168 : 126} height={17} borderRadius="4px" />
            <Skeleton width={index % 2 ? 104 : 132} height={13} borderRadius="4px" />
          </div>
          <Skeleton width={82} height={17} borderRadius="4px" />
        </div>
      ))}
    </div>
  );
}

/*
Structural inventory: Transactions receivable picker rows
Used in the receivable link modal; maps to the same transaction row rhythm but fewer rows inside the modal content.
*/
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
