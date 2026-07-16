import { Skeleton } from "@/components/ui/Skeleton";

export function BankSelectorSkeleton() {
  return (
    <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
      <div className="bank-selector-summary">
        <div className="bank-selector-main">
          <Skeleton width={44} height={24} borderRadius="4px" />
          <Skeleton width={132} height={18} borderRadius="4px" />
        </div>
        <div className="bank-selector-actions">
          <Skeleton width={22} height={22} borderRadius="6px" />
          <Skeleton width={22} height={22} borderRadius="6px" />
        </div>
      </div>
    </div>
  );
}
