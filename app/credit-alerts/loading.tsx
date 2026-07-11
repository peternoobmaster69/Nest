import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { CreditAlertsSkeleton } from "@/components/skeletons/CreditAlertsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Credit Alert Staging" current="/credit-alerts" userName="User" userImage={null}>
      <PageHeader title="Credit Alerts" description="Inspect the latest email alerts and diagnose parsing failures." eyebrow="Automation" />
      <CreditAlertsSkeleton />
    </PageFrame>
  );
}
