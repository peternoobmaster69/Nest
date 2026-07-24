import { PageFrame } from "@/components/page-frame";
import { BudgetPlanCompactCardsSkeleton } from "@/components/skeletons/BudgetPlanSkeleton";

export default function Loading() {
  return (
    <PageFrame title="Budget Plan" current="/budgets/plan" userName="User" userImage={null}>
      <div className="bp-container" aria-busy="true" aria-label="Loading budget plan">
        <section className="card" style={{ padding: "18px 20px" }}>
          <div className="bp-two-col">
            <div className="bp-col"><BudgetPlanCompactCardsSkeleton /></div>
            <div className="bp-col"><BudgetPlanCompactCardsSkeleton /></div>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
