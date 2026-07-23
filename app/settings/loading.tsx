import { PageFrame } from "@/components/page-frame";
import { RouteLoadingState } from "@/components/ui/route-state";

export default function Loading() {
  return <PageFrame title="Settings" current="/settings" userName="User" userImage={null}><RouteLoadingState label="Loading settings" /></PageFrame>;
}
