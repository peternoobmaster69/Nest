import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { RewardsPageSkeleton } from "@/components/skeletons/RewardsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Rewards" current="/rewards" userName="User" userImage={null}>
      <PageHeader title="Rewards & Miles" description="Track card rewards, airline miles, hotel points, and conversion rates." />
      <RewardsPageSkeleton />
    </PageFrame>
  );
}
