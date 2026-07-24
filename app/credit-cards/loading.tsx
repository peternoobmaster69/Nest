import { PageFrame } from "@/components/page-frame";
import { CreditCardsSkeleton } from "@/components/skeletons/CreditCardsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Credit Cards" current="/credit-cards" userName="User" userImage={null}>
      <div className="cc-container" aria-busy="true" aria-label="Loading credit cards">
        <div className="cc-grid"><CreditCardsSkeleton /></div>
      </div>
    </PageFrame>
  );
}
