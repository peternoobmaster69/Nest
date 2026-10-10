import { ApiRequestError } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";

export async function resolveReceivableSourceWorkspace(data: Readonly<{ accountId?: string | null; budgetId?: string | null }>) {
  let sourceWorkspaceId: string | null | undefined;
  if (data.accountId != null) {
    const account = await prisma.financialAccount.findUnique({
      where: { id: data.accountId },
      select: { id: true, workspaceId: true, kind: true, isActive: true },
    });
    if (account?.kind !== "BANK" || !account.isActive) {
      throw new ApiRequestError(400, "Selected deduction account is invalid.");
    }
    await requireWorkspaceAccess(account.workspaceId, "EDITOR");
    sourceWorkspaceId = account.workspaceId;
  } else if (data.accountId === null) {
    sourceWorkspaceId = null;
  }

  if (data.budgetId != null) {
    if (data.accountId == null || !sourceWorkspaceId) {
      throw new ApiRequestError(400, "Selected deduction subaccount is invalid.");
    }
    const budget = await prisma.budgetEnvelope.findFirst({
      where: { id: data.budgetId, workspaceId: sourceWorkspaceId, accountId: data.accountId, isActive: true },
      select: { id: true },
    });
    if (!budget) throw new ApiRequestError(400, "Selected deduction subaccount is invalid.");
  }
  return sourceWorkspaceId;
}
