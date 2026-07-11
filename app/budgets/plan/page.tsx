import { BudgetPlanPage } from "@/components/budget-plan-page";
import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/require-session";

export default async function BudgetPlanRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Budget Plan" current="/budgets/plan" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <PageHeader title="Budget Plan" description="Prepare monthly sources and allocations, then apply the plan once." />
      <BudgetPlanPage />
    </PageFrame>
  );
}
