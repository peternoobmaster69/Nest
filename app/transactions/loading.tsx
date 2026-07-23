import { PageFrame } from "@/components/page-frame";
import { TransactionsInitialSkeleton } from "@/components/skeletons/TransactionsSkeleton";

export default function Loading() {
  return <PageFrame title="Transactions" current="/transactions" userName="User" userImage={null}><TransactionsInitialSkeleton /></PageFrame>;
}
