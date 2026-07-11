import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { CreditTransactionsPageSkeleton } from "@/components/skeletons/CreditTransactionsSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Credit Card Transactions" current="/credit-transactions" userName="User" userImage={null}>
      <PageHeader title="Card Transactions" description="Review card activity, allocate spending, import statements, and manage payments." />
      <CreditTransactionsPageSkeleton />
    </PageFrame>
  );
}
