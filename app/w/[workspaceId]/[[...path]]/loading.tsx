import { PageFrame } from "@/components/page-frame";
import { DashboardSkeleton } from "@/components/skeletons/DashboardSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Dashboard" current="/" userName="User" userImage={null}>
      <DashboardSkeleton />
    </PageFrame>
  );
}
