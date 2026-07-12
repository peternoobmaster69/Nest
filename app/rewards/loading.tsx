import { PageFrame } from "@/components/page-frame";
import { RewardsPageSkeleton } from "@/components/skeletons/RewardsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Rewards" current="/rewards" userName="User" userImage={null}>
      <RewardsPageSkeleton />
    </PageFrame>
  );
}
