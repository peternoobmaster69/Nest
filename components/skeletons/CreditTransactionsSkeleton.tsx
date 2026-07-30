import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Credit transactions page shell
Route: /credit-transactions
Layout regions: PageFrame chrome static; .cct-container stacks filter bars, action controls, and data table at 14px gap.
Content blocks:
- Card chip bar: .cct-card-bar flex row, 6px gap, horizontally scrollable chips with 24x16 logo and 12px label.
- Period bar/actions: static controls in the loaded component are represented by button/input-sized skeletons because card/month counts are server or query data.
- Table wrapper: .cct-table-wrapper with .cct-table header rendered statically and six body rows from CreditTransactionsTableRowsSkeleton.
Do not skeletonize: PageFrame chrome; table headers; static import button position.
*/
export function CreditTransactionsPageSkeleton() {
  return (
    <div className="cct-container">
      <div className="cct-card-bar">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className={`cct-card-chip${index === 0 ? " active" : ""}`} key={index}>
            <Skeleton width={24} height={16} borderRadius="2px" />
            <Skeleton width={index === 0 ? 58 : 92} height={18} borderRadius="4px" />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <Skeleton width={130} height={36} borderRadius="var(--r-md)" />
        <Skeleton width={104} height={36} borderRadius="var(--r-md)" />
        <Skeleton width={120} height={36} borderRadius="var(--r-md)" />
        <Skeleton width={36} height={36} borderRadius="var(--r-md)" />
      </div>
      <div className="cct-table-wrapper">
        <table className="cct-table responsive-data-table">
          <caption className="sr-only">Loading credit card transactions</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Subject</th>
              <th scope="col">Amount</th>
              <th scope="col">Card</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <CreditTransactionsTableRowsSkeleton />
          </tbody>
        </table>
      </div>
    </div>
  );
}

/*
Structural inventory: Credit transactions table
Route: /credit-transactions
Layout regions: PageFrame chrome, card chip bar, period bar, summary/actions are static or derived from local state; table body is data-driven.
Content blocks:
- Table wrapper: .cct-table-wrapper, overflow-x auto, border radius var(--r-lg).
- Table: .cct-table, 13px font, headers fixed; tbody rows contain five cells and collapse to two visual rows on mobile.
- Row dimensions: td padding 10px 12px; date day line, subject, right-aligned mono amount, card checkbox row, action buttons 28px high.
Do not skeletonize: table header, filters, import/sync action controls.
*/
export function CreditTransactionsTableRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, index) => (
        <tr className="cct-transaction-row" key={index}>
          <td className="cct-tx-date">
            <Skeleton width={82} height={18} borderRadius="4px" />
          </td>
          <td className="cct-tx-subject">
            <div className="cct-subject-wrapper">
              <Skeleton width={index % 2 ? "86%" : "64%"} height={18} borderRadius="4px" />
            </div>
          </td>
          <td className="cct-tx-amount">
            <Skeleton width={88} height={18} borderRadius="4px" />
          </td>
          <td className="cct-tx-card">
            <label className="cct-card-checkbox">
              <Skeleton width={18} height={18} borderRadius="4px" />
              <Skeleton width={92} height={18} borderRadius="4px" />
            </label>
          </td>
          <td className="cct-tx-actions">
            <Skeleton width={28} height={28} borderRadius="var(--r-sm)" />
            <Skeleton width={28} height={28} borderRadius="var(--r-sm)" />
          </td>
        </tr>
      ))}
    </>
  );
}
