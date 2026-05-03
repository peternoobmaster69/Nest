import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Budget planning template grids
Route: /budgets/plan
Layout regions: PageFrame chrome, page tabs, section headings, and Add buttons are static.
Content blocks:
- Two-column layout: .bp-two-col with two .bp-col regions, gap 20px, collapses at 900px.
- Column grid: .st-grid inside each column; in budget plan CSS this becomes one column with 12px gap.
- Compact budget card: .st-card.bp-compact-card, padding 8px 10px; .bp-two-line-head with 24x24 icon, 13px title, 24px edit button; amount line 13px.
Do not skeletonize: Budget Sources/Budget Items headings and Add Source/Add Item buttons.
*/
export function BudgetPlanCompactCardsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="st-card bp-compact-card" key={index}>
          <div className="bp-two-line-head">
            <div className="bp-two-line-title-wrap">
              <Skeleton width={24} height={24} borderRadius="var(--r-md)" />
              <Skeleton width={index === 1 ? 158 : 118} height={16} borderRadius="4px" />
            </div>
            <Skeleton width={24} height={24} borderRadius="var(--r-sm)" />
          </div>
          <div className="bp-two-line-amount">
            <Skeleton width={86} height={16} borderRadius="4px" />
          </div>
        </div>
      ))}
    </>
  );
}
