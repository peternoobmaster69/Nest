import { Skeleton } from "@/components/ui/Skeleton";
import { BankSelectorSkeleton } from "@/components/skeletons/BankSelectorSkeleton";

/*
Structural inventory: Dashboard data regions
Route: /
Layout regions: persistent AppSidebar and topbar render as chrome; only dashboard body data regions skeletonize.
Content blocks:
- Bank selector row: shared with the transactions page so both routes reserve the same logo, balance, and action space while loading.
- Net worth strip: .bank-selector-row.dashboard-mini-card; label is 11px uppercase, primary value is 22px/1.5, breakdown is inline 11px links, right metric has 16px left padding and border.
- Hero card: .hero-card, padding 18px 20px, margin-bottom 14px; left total block has 12px uppercase label, 28px/1 amount, 12px subcopy, chip row of 22px pills.
- Credit-card summary panel: .card.cc-home-panel in .grid-2; header, three 68px stats, repeated grouped rows.
- Recent transactions panel: .card in .grid-2; static heading/action remain; rows are .crud-row-like list entries with icon, two text lines, right amount.
Do not skeletonize: sidebar, mobile hamburger/topbar, greeting title, static "View all" buttons, card section headings.
*/
export function DashboardSkeleton() {
  return (
    <>
      <DashboardBankSelectorSkeleton />
      <DashboardNetWorthSkeleton />
      <DashboardHeroSkeleton />
      <div className="grid-2" style={{ marginTop: "14px" }}>
        <DashboardCreditCardPanelSkeleton />
        <DashboardRecentTransactionsSkeleton />
      </div>
    </>
  );
}

/*
Structural inventory: Dashboard bank selector
Maps to .bank-selector-row > .bank-selector-summary with the same flex/gap/padding. Replaces logo, balance, and action buttons only.
*/
export function DashboardBankSelectorSkeleton() {
  return <BankSelectorSkeleton />;
}

/*
Structural inventory: Dashboard net worth strip
Maps to .bank-selector-row.dashboard-mini-card; two-column metric structure preserves the loaded strip height and internal flex spacing.
*/
export function DashboardNetWorthSkeleton() {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div className="bank-selector-row dashboard-mini-card">
        <div className="dashboard-mini-card-stack dashboard-mini-card-strip">
          <div className="dashboard-mini-card-primary">
            <Skeleton width={70} height={17} borderRadius="4px" />
            <Skeleton width={126} height={33} borderRadius="6px" />
            <div className="dashboard-mini-card-breakdown">
              <Skeleton width={96} height={17} borderRadius="4px" />
              <Skeleton width={7} height={17} borderRadius="4px" />
              <Skeleton width={76} height={17} borderRadius="4px" />
            </div>
          </div>
          <div className="dashboard-mini-card-metric dashboard-mini-card-gain">
            <Skeleton width={30} height={17} borderRadius="4px" />
            <Skeleton width={86} height={24} borderRadius="5px" />
            <Skeleton width={42} height={17} borderRadius="4px" />
          </div>
        </div>
      </div>
    </div>
  );
}

/*
Structural inventory: Dashboard hero
Maps to .hero-card > .hero-content and .hero-chips. The hero surface itself stays real so color, radius, and padding match the loaded card.
*/
export function DashboardHeroSkeleton() {
  return (
    <div className="hero-card">
      <div className="hero-content">
        <div className="hero-main">
          <Skeleton width={118} height={18} borderRadius="4px" />
          <Skeleton width={148} height={28} borderRadius="8px" />
          <Skeleton width={124} height={18} borderRadius="4px" />
        </div>
      </div>
      <div className="hero-chips">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="hero-chip" key={index}>
            <Skeleton width={8} height={8} borderRadius="999px" />
            {index === 5 ? null : <Skeleton width={index % 2 ? 66 : 78} height={11} borderRadius="4px" />}
            <Skeleton width={index === 5 ? 96 : index % 2 ? 34 : 42} height={11} borderRadius="4px" />
          </div>
        ))}
      </div>
    </div>
  );
}

/*
Structural inventory: Dashboard credit-card panel
Maps to .card.cc-home-panel: heading/action are static chrome; dynamic stats and due groups are skeletonized.
*/
export function DashboardCreditCardPanelSkeleton() {
  return (
    <div className="card cc-home-panel">
      <div className="cc-home-header">
        <div className="cc-home-title">
          <span aria-hidden="true"> </span>
          <span>Credit Cards</span>
        </div>
        <button className="btn btn-ghost btn-xs" type="button" disabled>
          View all
        </button>
      </div>
      <div className="cc-home-stats">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="cc-home-stat" key={index}>
            <Skeleton width={64} height={14} borderRadius="4px" />
            <Skeleton width={index === 0 ? 96 : 58} height={24} borderRadius="5px" />
          </div>
        ))}
      </div>
      <div className="cc-home-list">
        {Array.from({ length: 2 }).map((_, index) => (
          <div className="cc-home-group" key={index}>
            <div className="cc-home-group-head">
              <div className="cc-home-bank">
                <Skeleton width={34} height={34} borderRadius="999px" />
                <div className="cc-home-bank-copy">
                  <Skeleton width={112} height={16} borderRadius="4px" />
                  <Skeleton width={48} height={13} borderRadius="4px" />
                  <Skeleton width={82} height={13} borderRadius="4px" />
                </div>
              </div>
              <div className="cc-home-group-total">
                <Skeleton width={86} height={17} borderRadius="4px" />
                <Skeleton width={72} height={22} borderRadius="999px" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/*
Structural inventory: Dashboard recent transaction list
Maps to .simple-list containing repeated row cards with a left copy stack and right amount. Header and View all button are static.
*/
export function DashboardRecentTransactionsSkeleton() {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600 }}>Recent transactions</div>
        <button className="btn btn-ghost btn-xs" type="button" disabled>
          View all
        </button>
      </div>
      <div className="simple-list">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="crud-row" key={index}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
              <Skeleton width={30} height={30} borderRadius="999px" />
              <div style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                <Skeleton width={150} height={17} borderRadius="4px" />
                <Skeleton width={106} height={13} borderRadius="4px" />
              </div>
            </div>
            <Skeleton width={78} height={17} borderRadius="4px" />
          </div>
        ))}
      </div>
    </div>
  );
}
