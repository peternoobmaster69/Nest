import { PageFrame } from "@/components/page-frame";
import {
  InvestmentsAccountGridSkeleton,
  InvestmentsPortfolioHeaderSkeleton,
} from "@/components/skeletons/InvestmentsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Investments" current="/investments" userName="User" userImage={null}>
      <div className="inv-page" aria-busy="true" aria-label="Loading investments">
        <InvestmentsPortfolioHeaderSkeleton />
        <InvestmentsAccountGridSkeleton />
      </div>
    </PageFrame>
  );
}
