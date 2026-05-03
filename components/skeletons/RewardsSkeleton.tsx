import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Rewards page shell
Route: /rewards
Layout regions: PageFrame chrome static; page body is an unframed stack with summary card, tab segmented control, and active-tab content.
Content blocks:
- Summary stat-card: margin-bottom 20px, grid gap 12px; one primary total block and two .card-sm metric panels.
- Segmented tabs: static three-button .segmented control, not skeletonized.
- Credit-card rewards default tab: .rewards-cc-grid, repeat(4, 1fr), gap from CSS; cards use .card padding and action buttons.
Do not skeletonize: PageFrame chrome, tab labels, add-form chrome, modal chrome.
*/
export function RewardsPageSkeleton() {
  return (
    <div>
      <section className="stat-card" style={{ marginBottom: "20px", display: "grid", gap: "12px" }}>
        <RewardsSummarySkeleton />
      </section>
      <div className="segmented" style={{ marginBottom: "20px" }}>
        <button className="segmented-btn on" type="button" disabled>Credit Cards</button>
        <button className="segmented-btn" type="button" disabled>Frequent Flyer</button>
        <button className="segmented-btn" type="button" disabled>Conversions</button>
      </div>
      <div className="rewards-cc-grid" style={{ marginBottom: "20px" }}>
        <RewardsCardGridSkeleton />
      </div>
    </div>
  );
}

/*
Structural inventory: Rewards page summary
Route: /rewards
Layout regions: PageFrame chrome and tab segmented control are static; only reward totals/cards/history data skeletonize.
Content blocks:
- Summary stat-card: padding 16px, grid gap 12px; primary Total Miles block plus .grid-2 of two card-sm metric panels.
- Reward cards: credit card tab uses .rewards-cc-grid repeat(4, 1fr), gap 12px; frequent flyer tab uses .grid-2; conversion tab uses stacked .card rows.
- Card internals: top flex between title/meta and action button, 24px primary value, 16px secondary value, compact metadata lines.
Do not skeletonize: tab buttons, Add Frequent Flyer button, modal/form chrome.
*/
export function RewardsSummarySkeleton() {
  return (
    <>
      <div style={{ display: "grid", gap: "8px" }}>
        <Skeleton width={88} height={14} borderRadius="4px" />
        <Skeleton width={150} height={29} borderRadius="6px" />
        <Skeleton width={280} height={14} borderRadius="4px" />
      </div>
      <div className="grid-2" style={{ gap: "10px" }}>
        {Array.from({ length: 2 }).map((_, index) => (
          <div className="card-sm" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }} key={index}>
            <Skeleton width={index === 0 ? 148 : 128} height={14} borderRadius="4px" />
            <Skeleton width={96} height={24} borderRadius="5px" />
            <Skeleton width={86} height={14} borderRadius="4px" />
          </div>
        ))}
      </div>
    </>
  );
}

/*
Structural inventory: Rewards card grids
Maps to card layouts used by credit-card rewards and frequent-flyer rewards. Parent grid is supplied by the page (.rewards-cc-grid or .grid-2).
*/
export function RewardsCardGridSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="card" key={index}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "grid", gap: "4px" }}>
              <Skeleton width={index % 2 ? 132 : 156} height={16} borderRadius="4px" />
              <Skeleton width={96} height={13} borderRadius="4px" />
            </div>
            <Skeleton width={62} height={28} borderRadius="var(--r-sm)" />
          </div>
          <div style={{ marginTop: "12px", display: "grid", gap: "4px" }}>
            <Skeleton width={104} height={29} borderRadius="6px" />
            <Skeleton width={92} height={20} borderRadius="5px" />
            <Skeleton width="80%" height={14} borderRadius="4px" />
          </div>
        </div>
      ))}
    </>
  );
}

/*
Structural inventory: Rewards transaction history and conversion rows
Maps to stacked .card rows with top metadata, values, and action controls; used inside history/conversion sections.
*/
export function RewardsRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="card" style={{ marginBottom: "8px" }} key={index}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
            <div style={{ display: "grid", gap: "5px", minWidth: 0 }}>
              <Skeleton width={index === 1 ? 176 : 138} height={17} borderRadius="4px" />
              <Skeleton width={112} height={13} borderRadius="4px" />
            </div>
            <Skeleton width={88} height={18} borderRadius="4px" />
          </div>
        </div>
      ))}
    </>
  );
}
