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

    const workspaceDefaults = await prisma.workspace.findUnique({
      where: { id: receivable.workspaceId },
      select: {
        id: true,
        name: true,
        receivableDefaultAccountId: true,
        receivableDefaultBudgetId: true,
      },
    });
    if (!workspaceDefaults?.receivableDefaultAccountId || !workspaceDefaults.receivableDefaultBudgetId) {
      return NextResponse.json(
        { error: "Configure default receivable account and subaccount in Settings before closing." },
        { status: 400 },
      );
    }

    const targetAccount = await prisma.financialAccount.findFirst({
      where: {
        id: workspaceDefaults.receivableDefaultAccountId,
        workspaceId: workspaceDefaults.id,
        kind: "BANK",
        isActive: true,
      },
      select: { id: true, name: true, workspaceId: true },
    });
    if (!targetAccount) {
      return NextResponse.json(
        { error: "Default receivable account is invalid. Update Settings." },
        { status: 400 },
      );
    }

    const targetBudget = await prisma.budgetEnvelope.findFirst({
      where: {
        id: workspaceDefaults.receivableDefaultBudgetId,
        workspaceId: workspaceDefaults.id,
        accountId: targetAccount.id,
        isActive: true,
      },
      select: { id: true, accountId: true, workspaceId: true },
    });
    if (!targetBudget) {
      return NextResponse.json(
        { error: "Default receivable subaccount is invalid. Update Settings." },
        { status: 400 },
      );
    }
    const targetWorkspaceId = targetBudget.workspaceId;

    // Destination workspace for receivable close-in posting
    const destinationWorkspace = await prisma.workspace.findUnique({
      where: { id: targetWorkspaceId },
      select: { id: true, name: true },
    });
    if (!destinationWorkspace) {
      return NextResponse.json({ error: "Destination workspace not found" }, { status: 404 });
    }

    let sourceAccount: { id: string; name: string; workspaceId: string } | null = null;
    let sourceBudget: { id: string } | null = null;
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

      if (!receivable.budgetId) {
        return NextResponse.json(
          { error: "Selected deduction subaccount is invalid." },
          { status: 400 },
        );
      }
      const budget = await prisma.budgetEnvelope.findFirst({
        where: {
          id: receivable.budgetId,
          workspaceId: account.workspaceId,
          accountId: account.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!budget) {
        return NextResponse.json(
          { error: "Selected deduction subaccount is invalid." },
          { status: 400 },
        );
      }
      sourceBudget = budget;
    }

    const closeDate = parsed.data.closeDate ? new Date(parsed.data.closeDate) : new Date();
    const externalRef = `receivable-close:${receivable.id}:${Date.now()}`;
    const note = receivable.remarkTogether?.trim() || receivable.title || "Receivable";

    const result = await prisma.$transaction(async (db) => {
      const incomeTx = await db.transaction.create({
        data: {
          workspaceId: targetWorkspaceId,
          accountId: targetAccount.id,
          kind: "RECEIVABLE_PAYMENT",
          direction: "CREDIT",
          budgetId: targetBudget.id,
          date: closeDate,
          amountCents: receivable.amountCents,
          subject: note,
          details: sourceAccount ? `Receivable closed • funded from ${sourceAccount.name}` : "Receivable closed",
          externalRef,
          isSynced: false,
          isFromFamily: false,
        },
      });

      let sourceTxId: string | null = null;
      const shouldCreateSourceDeduction =
        sourceAccount &&
        sourceBudget &&
        (sourceAccount.workspaceId !== targetAccount.workspaceId ||
          sourceAccount.id !== targetAccount.id ||
          sourceBudget.id !== targetBudget.id);

      if (shouldCreateSourceDeduction && sourceAccount && sourceBudget) {
        const sourceTx = await db.transaction.create({
          data: {
            workspaceId: sourceAccount.workspaceId,
            accountId: sourceAccount.id,
            kind: "TRANSFER",
            direction: "DEBIT",
            budgetId: sourceBudget.id,
            date: closeDate,
            amountCents: receivable.amountCents,
            subject: note,
            details: `Receivable transfer out • to workspace "${destinationWorkspace.name}" receivable account`,
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

      await recalculateBudgetAvailableCents(db, targetWorkspaceId, targetBudget.id);
      if (sourceAccount && sourceBudget) {
        await recalculateBudgetAvailableCents(db, sourceAccount.workspaceId, sourceBudget.id);
      }

      return {
        receivable: updatedReceivable,
        incomeTransactionId: incomeTx.id,
        sourceTransactionId: sourceTxId,
      };
    }, {
      maxWait: 10_000,
      timeout: 20_000,
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
