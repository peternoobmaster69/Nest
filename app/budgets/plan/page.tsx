import { BudgetPlanPage } from "@/components/budget-plan-page";
import { PageFrame } from "@/components/page-frame";
import { requireSession } from "@/lib/require-session";

export default async function BudgetPlanRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Budget Plan" current="/budgets/plan" userName={userName} userImage={session.user?.image || null}>
      <BudgetPlanPage />
    </PageFrame>
  );
}
