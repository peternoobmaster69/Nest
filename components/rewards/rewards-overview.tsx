import { Building2, CreditCard, Plane } from "lucide-react";
import { RewardsSummarySkeleton } from "@/components/skeletons/RewardsSkeleton";

const formatNumber = (value: number) => value.toLocaleString("en-SG");

export function RewardsOverview({
  loading,
  cardMiles,
  cardCount,
  frequentFlyerMiles,
  frequentFlyerCount,
  hotelPoints,
  hotelCount,
  hotelValue,
  combinedMiles,
  formatCurrency,
}: Readonly<{
  loading: boolean;
  cardMiles: number;
  cardCount: number;
  frequentFlyerMiles: number;
  frequentFlyerCount: number;
  hotelPoints: number;
  hotelCount: number;
  hotelValue: number;
  combinedMiles: number;
  formatCurrency: (value: number) => string;
}>) {
  return (
    <section className="rewards-overview">
      {loading ? <RewardsSummarySkeleton /> : (
        <>
          <div className="rewards-overview-grid">
            <div className="rewards-overview-card">
              <div className="rewards-overview-label"><CreditCard size={16} aria-hidden="true" />Card Miles</div>
              <div className="rewards-overview-value">{formatNumber(cardMiles)}</div>
              <div className="rewards-overview-sub">Across {cardCount} cards</div>
            </div>
            <div className="rewards-overview-card">
              <div className="rewards-overview-label"><Plane size={16} aria-hidden="true" />Frequent Flyer</div>
              <div className="rewards-overview-value">{formatNumber(frequentFlyerMiles)}</div>
              <div className="rewards-overview-sub">Across {frequentFlyerCount} programs</div>
            </div>
            <div className="rewards-overview-card">
              <div className="rewards-overview-label"><Building2 size={16} aria-hidden="true" />Hotel Points</div>
              <div className="rewards-overview-value">{formatNumber(hotelPoints)}</div>
              <div className="rewards-overview-sub">Across {hotelCount} programs</div>
              <div className="rewards-overview-value-sub">~ {formatCurrency(hotelValue)}</div>
            </div>
          </div>
          <div className="rewards-total-panel">
            <div>
              <div className="rewards-total-label">Total travel miles</div>
              <div className="rewards-total-value">{formatNumber(combinedMiles)}</div>
              <div className="rewards-total-sub">Cards + frequent flyer combined</div>
            </div>
            <div className="rewards-total-divider" aria-hidden="true" />
            <div>
              <div className="rewards-total-label">Hotel points value</div>
              <div className="rewards-total-value">{formatCurrency(hotelValue)}</div>
              <div className="rewards-total-sub">{formatNumber(hotelPoints)} points tracked separately</div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
