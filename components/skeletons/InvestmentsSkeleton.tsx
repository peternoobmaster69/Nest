import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Investments page loading regions
Route: /investments
Layout regions: PageFrame chrome static; .inv-page is a grid with a compact responsive gap.
Content blocks:
- Portfolio header card: .card.inv-portfolio-card uses responsive page-specific padding; .inv-portfolio-header flex row, 24px gap, large primary value with withdrawable subline and three smaller metric blocks.
- View toggle card: static selected-view text/segmented controls are synchronous and not skeletonized.
- Account grid: .inv-account-grid, repeat(6, 1fr), gap 8px; .card.inv-account-card padding 10px 10px 8px.
- Account card internals: edit circle 20px, title 16px, meta 11px, two amount columns with 9px labels and 12px values, inception pill.
Do not skeletonize: Add Account button, view toggle controls, modal chrome.
*/
export function InvestmentsPortfolioHeaderSkeleton() {
  return (
    <section className="card inv-portfolio-card">
      <div className="inv-portfolio-header">
        <div style={{ flex: "1 1 200px" }}>
          <Skeleton width={148} height={15} borderRadius="4px" />
          <Skeleton width={210} height={38} borderRadius="8px" />
          <div className="inv-withdrawable-summary">
            <Skeleton width={168} height={14} borderRadius="4px" />
            <Skeleton width={88} height={16} borderRadius="4px" />
          </div>
        </div>
        <Skeleton width={1} height={50} borderRadius="0" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div style={{ flex: "0 1 150px" }} key={index}>
            <Skeleton width={index === 0 ? 88 : 62} height={15} borderRadius="4px" />
            <Skeleton width={102} height={22} borderRadius="5px" />
          </div>
        ))}
      </div>
    </section>
  );
}

/*
Structural inventory: Investments account grid
Repeats loaded .card.inv-account-card nodes in .inv-account-grid with exact internal grid/flex structure and action sizes.
*/
export function InvestmentsAccountGridSkeleton() {
  return (
    <section className="inv-account-grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <article className="card inv-account-card" key={index}>
          <span className="inv-edit-icon" aria-hidden="true">
            <Skeleton width={10} height={10} borderRadius="999px" />
          </span>
          <div className="inv-account-select">
            <div className="inv-account-head">
              <Skeleton width={index % 2 ? 118 : 92} height={21} borderRadius="4px" />
              <Skeleton width={136} height={13} borderRadius="4px" />
            </div>
            <div className="inv-account-amounts">
              <div>
                <Skeleton width={42} height={11} borderRadius="4px" />
                <Skeleton width={72} height={15} borderRadius="4px" />
              </div>
              <div>
                <Skeleton width={38} height={11} borderRadius="4px" />
                <Skeleton width={78} height={15} borderRadius="4px" />
              </div>
            </div>
          </div>
          <div className="inv-account-actions">
            <Skeleton width={72} height={22} borderRadius="999px" />
            <Skeleton width={28} height={28} borderRadius="var(--r-sm)" />
          </div>
        </article>
      ))}
    </section>
  );
}
