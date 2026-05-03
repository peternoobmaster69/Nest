import { PageFrame } from "@/components/page-frame";
import { CreditTransactionsPageSkeleton } from "@/components/skeletons/CreditTransactionsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Credit Card Transactions" current="/credit-transactions" userName="User" userImage={null}>
      <CreditTransactionsPageSkeleton />
    </PageFrame>
  );
}
