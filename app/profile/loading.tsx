import { PageFrame } from "@/components/page-frame";
import { GenericPageSkeleton } from "@/components/skeletons/GenericPageSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Profile" current="/profile" userName="User" userImage={null}>
      <GenericPageSkeleton />
    </PageFrame>
  );
}
