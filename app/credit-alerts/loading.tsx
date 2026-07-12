import { PageFrame } from "@/components/page-frame";
import { CreditAlertsSkeleton } from "@/components/skeletons/CreditAlertsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Credit Alert Staging" current="/credit-alerts" userName="User" userImage={null}>
      <CreditAlertsSkeleton />
    </PageFrame>
  );
}
