import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Receivables page
Route: /receivables
Layout regions: PageFrame chrome static; page body is a grid with 14px gap.
Content blocks:
- Summary card: .card; top flex aligns total amount and open count, followed by .recv-month-grid month chips and .recv-toolbar controls.
- Month chips: 12 repeated .recv-month-chip buttons; static month labels render immediately, only count badges are data-driven.
- Toolbar: sort selects, checkbox, and Add Receivable button are static controls and not skeletonized.
- Receivable rows: .simple-list > .crud-row.recv-row; grid columns main / amount / actions. Main has 16px title and 11px meta; amount is 16px; actions are compact buttons.
Do not skeletonize: month labels, toolbar controls, Add Receivable button, modal chrome.
*/
export function ReceivablesSummarySkeleton() {
  return (
    <>
      <Skeleton width={140} height={26} borderRadius="8px" />
      <Skeleton width={56} height={14} borderRadius="999px" />
    </>
  );
}

/*
Structural inventory: Receivables list rows
Uses the exact .crud-row.recv-row grid as loaded receivables and replaces title, metadata, amount, and action button content.
*/
export function ReceivablesListSkeleton() {
  return (
    <div className="simple-list">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="crud-row recv-row" key={index}>
          <div className="recv-row-main">
            <Skeleton width={index % 2 ? 188 : 132} height={20} borderRadius="4px" />
            <Skeleton width={index % 2 ? 220 : 164} height={13} borderRadius="4px" />
          </div>
          <div className="recv-row-amount">
            <Skeleton width={84} height={20} borderRadius="4px" />
          </div>
          <div className="recv-row-actions">
            <Skeleton width={56} height={28} borderRadius="var(--r-sm)" />
            <Skeleton width={28} height={28} borderRadius="var(--r-sm)" />
          </div>
        </div>
      ))}
    </div>
  );
}
