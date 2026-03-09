import { prisma } from "@/lib/prisma";
import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CloseReceivableSchema = z.object({
  closeDate: z.string().datetime().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine
    }
    const parsed = CloseReceivableSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(", ");
      return NextResponse.json({ error: `Invalid input: ${issues}` }, { status: 400 });
    }

    const receivable = await prisma.receivable.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        budgetId: true,
        amountCents: true,
        status: true,
        title: true,
        remarkTogether: true,
      },
    });
    if (!receivable) {
      return NextResponse.json({ error: "Receivable not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(receivable.workspaceId);

    if (receivable.status === "PAID") {
      return NextResponse.json({ error: "Receivable is already closed." }, { status: 400 });
    }

    const targetWorkspace = await prisma.workspace.findUnique({
      where: { id: receivable.workspaceId },
      select: { id: true, name: true },
    });
    if (!targetWorkspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Require a subaccount to be selected on the receivable
    if (!receivable.budgetId) {
      return NextResponse.json(
        { error: "Please select a subaccount for this receivable before closing." },
        { status: 400 },
      );
    }

    // Use the user-selected subaccount
    const selectedBudget = await prisma.budgetEnvelope.findFirst({
      where: {
        id: receivable.budgetId,
        workspaceId: receivable.workspaceId,
        isActive: true,
      },
      select: { id: true, accountId: true },
    });
    if (!selectedBudget) {
      return NextResponse.json(
        { error: "Selected subaccount is no longer available. Please update the receivable." },
        { status: 400 },
      );
    }
    const targetBudgetId = selectedBudget.id;
    const targetAccountId = selectedBudget.accountId;

    const targetAccount = await prisma.financialAccount.findFirst({
      where: {
        id: targetAccountId,
        workspaceId: receivable.workspaceId,
        kind: "BANK",
        isActive: true,
      },
      select: { id: true, name: true, workspaceId: true },
    });
    if (!targetAccount) {
      return NextResponse.json(
        { error: "Target account is invalid. Update the receivable subaccount or Settings." },
        { status: 400 },
      );
    }

    const targetBudget = await prisma.budgetEnvelope.findFirst({
      where: {
        id: targetBudgetId,
        workspaceId: receivable.workspaceId,
        accountId: targetAccount.id,
        isActive: true,
      },
      select: { id: true },
    });
    if (!targetBudget) {
      return NextResponse.json(
        { error: "Target subaccount is invalid. Update the receivable subaccount or Settings." },
        { status: 400 },
      );
    }

    let sourceAccount: { id: string; name: string; workspaceId: string } | null = null;
    if (receivable.accountId) {
      const account = await prisma.financialAccount.findFirst({
        where: { id: receivable.accountId, kind: "BANK", isActive: true },
        select: { id: true, name: true, workspaceId: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Selected deduction account is invalid." }, { status: 400 });
      }
      await requireWorkspaceAccess(account.workspaceId);
      sourceAccount = account;
    }

    const closeDate = parsed.data.closeDate ? new Date(parsed.data.closeDate) : new Date();
    const externalRef = `receivable-close:${receivable.id}:${Date.now()}`;
    const note = receivable.remarkTogether?.trim() || receivable.title || "Receivable";

    const result = await prisma.$transaction(async (db) => {
      const incomeTx = await db.transaction.create({
        data: {
          workspaceId: targetWorkspace.id,
          accountId: targetAccount.id,
          kind: "RECEIVABLE_PAYMENT",
          direction: "CREDIT",
          budgetId: targetBudget.id,
          date: closeDate,
          amountCents: receivable.amountCents,
          subject: `Receivable closed: ${note}`,
          details: sourceAccount ? `Funded from ${sourceAccount.name}` : "Receivable settled",
          externalRef,
          isSynced: false,
          isFromFamily: false,
        },
      });

      let sourceTxId: string | null = null;
      const shouldCreateSourceDeduction =
        sourceAccount &&
        (sourceAccount.workspaceId !== targetAccount.workspaceId || sourceAccount.id !== targetAccount.id);

      if (shouldCreateSourceDeduction && sourceAccount) {
        const sourceTx = await db.transaction.create({
          data: {
            workspaceId: sourceAccount.workspaceId,
            accountId: sourceAccount.id,
            kind: "TRANSFER",
            direction: "DEBIT",
            date: closeDate,
            amountCents: receivable.amountCents,
            subject: `Receivable transfer out: ${note}`,
            details: `To workspace "${targetWorkspace.name}" default receivable account`,
            externalRef,
            isSynced: false,
            isFromFamily: false,
          },
        });
        sourceTxId = sourceTx.id;
      }

      const updatedReceivable = await db.receivable.update({
        where: { id: receivable.id },
        data: {
          status: "PAID",
          transactionDate: closeDate,
        },
      });

      await recalculateBudgetAvailableCents(db, targetWorkspace.id, targetBudget.id);

      return {
        receivable: updatedReceivable,
        incomeTransactionId: incomeTx.id,
        sourceTransactionId: sourceTxId,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to close receivable", message }, { status: 500 });
  }
}
