import { Skeleton } from "@/components/ui/Skeleton";
import { BankSelectorSkeleton } from "@/components/skeletons/BankSelectorSkeleton";

/*
Structural inventory: Dashboard data regions
Route: /
Layout regions: persistent AppSidebar and topbar render as chrome; only dashboard body data regions skeletonize.
Content blocks:
- Unified overview: bank identity, available balance, primary actions, three metrics, and compact sub-account shortcuts.
- Main grid: dominant cash-flow panel, compact payment-due panel, then a full-width recent transaction list.
Do not skeletonize: sidebar, mobile hamburger/topbar, greeting title, static "View all" buttons, card section headings.
*/
export function DashboardSkeleton() {
  return (
    <>
      <DashboardOverviewSkeleton />
      <div className="dashboard-home-grid">
        <section className="card cash-flow-card dashboard-cash-flow-panel">
          <div className="cash-flow-head">
            <Skeleton width={132} height={28} borderRadius="8px" />
            <Skeleton width={148} height={18} borderRadius="6px" />
          </div>
          <div className="cash-flow-chart-skeleton skeleton" />
        </section>
        <DashboardCreditCardPanelSkeleton />
        <section className="card dashboard-recent-panel">
          <div className="dashboard-section-header">
            <Skeleton width={156} height={28} borderRadius="8px" />
            <Skeleton width={68} height={28} borderRadius="8px" />
          </div>
          <DashboardRecentTransactionsSkeleton />
        </section>
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

/* Mirrors the unified dashboard overview so loading does not shift its three responsive regions. */
export function DashboardOverviewSkeleton() {
  return (
    <section className="dashboard-overview-card" aria-label="Loading account overview">
      <header className="dashboard-overview-header">
        <div className="dashboard-overview-bank">
          <Skeleton width={40} height={30} borderRadius="9px" />
          <div className="dashboard-overview-bank-copy">
            <Skeleton width={48} height={10} borderRadius="4px" />
            <Skeleton width={130} height={16} borderRadius="4px" />
          </div>
        </div>
        <Skeleton width={32} height={32} borderRadius="8px" />
      </header>

      <div className="dashboard-overview-main">
        <div>
          <Skeleton width={132} height={13} borderRadius="4px" />
          <div style={{ marginTop: "7px" }}><Skeleton width={210} height={40} borderRadius="8px" /></div>
          <div style={{ marginTop: "8px" }}><Skeleton width={118} height={13} borderRadius="4px" /></div>
        </div>
        <div className="dashboard-overview-actions">
          <Skeleton width={132} height={34} borderRadius="8px" />
          <Skeleton width={142} height={34} borderRadius="8px" />
        </div>
      </div>

      <div className="dashboard-overview-metrics">
        {Array.from({ length: 3 }).map((_, index) => (
          <article className="dashboard-overview-metric" key={index}>
            <Skeleton width={30} height={30} borderRadius="9px" />
            <div>
              <Skeleton width={index === 2 ? 62 : 74} height={11} borderRadius="4px" />
              <Skeleton width={index === 2 ? 112 : 96} height={22} borderRadius="5px" />
              <Skeleton width={98} height={11} borderRadius="4px" />
            </div>
          </article>
        ))}
      </div>

      <div className="dashboard-overview-accounts">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} width={index % 2 ? 126 : 146} height={30} borderRadius="999px" />
        ))}
      </div>
    </section>
  );
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
    <section className="card cc-home-panel dashboard-payments-panel">
      <div className="cc-home-header">
        <div className="cc-home-title">
          <span aria-hidden="true"> </span>
          <span>Payments due</span>
        </div>
        <button className="btn btn-ghost btn-xs" type="button" disabled>
          View all
        </button>
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
    </section>
  );
}

/*
Structural inventory: Dashboard recent transaction list
Maps to .simple-list containing repeated row cards with a left copy stack and right amount. Header and View all button are static.
*/
export function DashboardRecentTransactionsSkeleton() {
  return (
    <div className="simple-list dashboard-recent-list-skeleton">
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
  );
}
