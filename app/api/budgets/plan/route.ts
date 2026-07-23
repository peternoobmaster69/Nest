import {
  DELETE as deleteBudgetPlan,
  GET as getBudgetPlan,
  PATCH as patchBudgetPlan,
  POST as postBudgetPlan,
} from "@/lib/domains/ledger/budget-plan/handlers";

// Compatibility transport for the existing public workflow. The domain handlers own
// executePosting, postingGroupId, and monthly-budget-confirm: idempotency semantics.
export async function GET(request: Request) {
  return getBudgetPlan(request);
}

export async function POST(request: Request) {
  // Authorization is performed by the domain handler:
  // requireWorkspaceAccess(body.workspaceId, "EDITOR")
  return postBudgetPlan(request);
}

export async function PATCH(request: Request) {
  // requireWorkspaceAccess(body.workspaceId, "EDITOR")
  return patchBudgetPlan(request);
}

export async function DELETE(request: Request) {
  // requireWorkspaceAccess(query.workspaceId, "EDITOR")
  return deleteBudgetPlan(request);
}
