import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Credit alert staging table
Route: /credit-alerts
Layout regions: PageFrame sidebar/topbar static chrome; body contains one .card with a static title/subtitle and a data-driven table.
Content blocks:
- Card: .card surface with 12px header margin, static section title and descriptive copy.
- Table wrapper: .cct-table-wrapper, overflow-x auto, rounded table surface.
- Table: .cct-table, 10 columns; header labels are static and render immediately.
- Rows: td padding follows .cct-table CSS; data cells are 13px body text at 1.5 line-height, so skeleton lines are 18px tall.
- Repeats: 8 table rows to fill the initial viewport without causing long-page overflow.
Do not skeletonize: PageFrame chrome, card heading/subtitle, table column headers, empty state copy.
*/
export function CreditAlertsSkeleton() {
  return (
    <div className="card">
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "14px", fontWeight: 700 }}>Recent Gmail / Email Alert Staging</div>
        <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
          Latest 100 staged alert rows for the current workspace.
        </div>
      </div>

      <div className="cct-table-wrapper">
        <table className="cct-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Source</th>
              <th>Subject</th>
              <th>Bank</th>
              <th>Card</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Txn Date</th>
              <th>Failure</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, index) => (
              <tr key={index}>
                <td><Skeleton width={132} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={index % 3 === 0 ? 74 : 58} height={18} borderRadius="999px" /></td>
                <td><Skeleton width={64} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={index % 2 ? 240 : 180} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={index % 2 ? 78 : 48} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={42} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={index % 2 ? 112 : 86} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={76} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={92} height={18} borderRadius="4px" /></td>
                <td><Skeleton width={index % 4 === 0 ? 150 : 18} height={18} borderRadius="4px" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
