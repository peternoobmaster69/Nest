import { PageFrame } from "@/components/page-frame";
import { GenericPageSkeleton } from "@/components/skeletons/GenericPageSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Admin" current="/admin" userName="User" userImage={null}>
      <GenericPageSkeleton />
    </PageFrame>
  );
}
