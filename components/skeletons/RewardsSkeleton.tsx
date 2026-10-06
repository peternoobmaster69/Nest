import { Skeleton } from "@/components/ui/Skeleton";
import { ArrowLeftRight, Building2, CreditCard, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RewardsPageSkeleton() {
  return (
    <div>
      <section className="rewards-overview">
        <RewardsSummarySkeleton />
      </section>
      <div className="rewards-tabs-row">
        <div className="segmented rewards-tabs">
          <Button className="segmented-btn on" type="button" disabled aria-label="Credit cards">
            <CreditCard className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Credit cards</span>
          </Button>
          <Button className="segmented-btn" type="button" disabled aria-label="Frequent flyer">
            <Plane className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Frequent flyer</span>
          </Button>
          <Button className="segmented-btn" type="button" disabled aria-label="Hotel rewards">
            <Building2 className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Hotel rewards</span>
          </Button>
          <Button className="segmented-btn" type="button" disabled aria-label="Conversions">
            <ArrowLeftRight className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Conversions</span>
          </Button>
        </div>
        <Skeleton className="rewards-tab-action-skeleton" width={168} height={34} borderRadius="var(--r-md)" />
      </div>
      <div className="rewards-cc-grid">
        <RewardsCardGridSkeleton />
      </div>
    </div>
  );
}

export function RewardsSummarySkeleton() {
  return (
    <>
      <div className="rewards-overview-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="rewards-overview-card" key={index}>
            <div className="rewards-overview-label">
              <Skeleton width={16} height={16} borderRadius="4px" />
              <Skeleton width={index === 1 ? 122 : 96} height={14} borderRadius="4px" />
            </div>
            <Skeleton width={index === 2 ? 94 : 132} height={31} borderRadius="6px" />
            <Skeleton width={index === 0 ? 112 : 132} height={14} borderRadius="4px" />
            {index === 2 ? <Skeleton width={70} height={14} borderRadius="4px" /> : null}
          </div>
        ))}
      </div>
      <div className="rewards-total-panel">
        <div>
          <Skeleton width={124} height={16} borderRadius="4px" />
          <Skeleton width={136} height={31} borderRadius="6px" />
          <Skeleton width={198} height={14} borderRadius="4px" />
        </div>
        <div className="rewards-total-divider" aria-hidden="true" />
        <div>
          <Skeleton width={130} height={16} borderRadius="4px" />
          <Skeleton width={96} height={31} borderRadius="6px" />
          <Skeleton width={196} height={14} borderRadius="4px" />
        </div>
      </div>
    </>
  );
}

export function RewardsCardGridSkeleton({ variant = "standard" }: Readonly<{ variant?: "standard" | "hotel" }>) {
  if (variant === "hotel") {
    return (
      <>
        {Array.from({ length: 2 }).map((_, index) => (
          <div className="card rewards-item-card" key={index}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: "4px" }}>
                <Skeleton width={index === 0 ? 156 : 132} height={16} borderRadius="4px" />
                <Skeleton width={112} height={13} borderRadius="4px" />
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <Skeleton width={44} height={28} borderRadius="var(--r-sm)" />
                <Skeleton width={62} height={28} borderRadius="var(--r-sm)" />
              </div>
            </div>
            <div style={{ marginTop: "12px", display: "grid", gap: "4px" }}>
              <Skeleton width={96} height={29} borderRadius="6px" />
              <Skeleton width={82} height={20} borderRadius="5px" />
              <Skeleton width="72%" height={14} borderRadius="4px" />
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="card rewards-item-card" key={index}>
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
