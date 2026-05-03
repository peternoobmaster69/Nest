import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Settings auto-accounting rules
Route: /settings
Layout regions: PageFrame chrome static; settings cards and section headings remain visible.
Content blocks:
- Auto rules container: .card with static header/actions, then grid gap 12px of rule cards.
- Rule card: border 1px solid var(--border), border-radius 14px, padding 14px, background var(--surface); header row, filter/action fields, compact buttons.
Do not skeletonize: section title, explanatory copy, Reset/Run/Save buttons.
*/
export function SettingsAutoRulesSkeleton() {
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} style={{ border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", background: "var(--surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ display: "grid", gap: "5px", minWidth: 0 }}>
              <Skeleton width={index === 1 ? 188 : 148} height={17} borderRadius="4px" />
              <Skeleton width={220} height={13} borderRadius="4px" />
            </div>
            <Skeleton width={72} height={28} borderRadius="var(--r-sm)" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px" }}>
            <Skeleton width="100%" height={38} borderRadius="var(--r-md)" />
            <Skeleton width="100%" height={38} borderRadius="var(--r-md)" />
            <Skeleton width="100%" height={38} borderRadius="var(--r-md)" />
            <Skeleton width="100%" height={38} borderRadius="var(--r-md)" />
          </div>
        </div>
      ))}
    </div>
  );
}

/*
Structural inventory: Settings bank account grid
Maps to .st-grid > .st-card bank account cards: 40x24 logo, Edit button, title/bank/description body, two stat columns.
*/
export function SettingsBankAccountsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="st-card" key={index}>
          <div className="st-card-header">
            <div className="st-card-bank">
              <Skeleton width={40} height={24} borderRadius="4px" />
            </div>
            <div className="st-card-actions">
              <Skeleton width={42} height={28} borderRadius="var(--r-sm)" />
            </div>
          </div>
          <div className="st-card-body">
            <Skeleton width={index % 2 ? 150 : 112} height={20} borderRadius="4px" />
            <Skeleton width={96} height={15} borderRadius="4px" />
            <Skeleton width="82%" height={17} borderRadius="4px" />
          </div>
          <div className="st-card-stats">
            <div className="st-stat">
              <Skeleton width={46} height={13} borderRadius="4px" />
              <Skeleton width={86} height={18} borderRadius="4px" />
            </div>
            <div className="st-stat">
              <Skeleton width={64} height={13} borderRadius="4px" />
              <Skeleton width={86} height={18} borderRadius="4px" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
