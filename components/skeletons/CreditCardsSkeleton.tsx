import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Credit cards page
Route: /credit-cards
Layout regions: PageFrame chrome is static; .cc-container contains page-local header and card grid.
Content blocks:
- Header: .cc-header with static h2 and Add Card button, not skeletonized.
- Card grid: .cc-grid with auto-fill minmax(320px, 1fr), gap 20px.
- Credit card item: .cc-card-wrapper height 200px; .cc-card-front absolute inset, border-radius 16px, padding 20px 22px, flex column.
- Internal card data: bank logo/fallback 100x36 max, masked card number 20px line, footer name and expiry.
Do not skeletonize: page header title, Add Card button, toast/modal chrome.
*/
export function CreditCardsSkeleton() {
  return (
    <div className="cc-grid">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="cc-card-wrapper" key={index}>
          <div className="cc-card-front" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
            <div className="cc-card-header">
              <div className="cc-bank-logo">
                <Skeleton width={100} height={36} borderRadius="4px" />
              </div>
            </div>
            <Skeleton width="72%" height={24} borderRadius="5px" />
            <div className="cc-card-footer">
              <Skeleton width="48%" height={17} borderRadius="4px" />
              <Skeleton width={48} height={16} borderRadius="4px" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
