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
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="cc-card-wrapper" key={index}>
          <div className="cc-card-front cc-card-skeleton">
            <div className="cc-card-header">
              <div className="cc-bank-logo">
                <Skeleton width={70} height={24} borderRadius="6px" />
              </div>
            </div>
            <Skeleton width={42} height={30} borderRadius="7px" />
            <Skeleton width="72%" height={21} borderRadius="5px" />
            <div className="cc-card-footer">
              <Skeleton width="46%" height={16} borderRadius="5px" />
              <Skeleton width={44} height={16} borderRadius="5px" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
