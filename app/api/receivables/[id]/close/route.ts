import { prisma } from "@/lib/prisma";
import { applyBudgetAvailableDelta } from "@/lib/budget-ledger";
import {
  claimReceivable,
  createLedgerTransaction,
  createPostingGroupRecord,
  executePosting,
  getIdempotencyKey,
  PostingConflictError,
} from "@/lib/posting-service";
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
        sourceWorkspaceId: true,
        sourceAccountId: true,
        sourceBudgetId: true,
        amountCents: true,
        status: true,
        title: true,
        notes: true,
      },
    });
    if (!receivable) {
      return NextResponse.json({ error: "Receivable not found" }, { status: 404 });
    }

    const { userId } = await requireWorkspaceAccess(receivable.workspaceId, "EDITOR");

    const workspaceDefaults = await prisma.workspace.findUnique({
      where: { id: receivable.workspaceId },
      select: {
        id: true,
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
      select: { id: true, workspaceId: true },
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

    const effectiveSourceAccountId = receivable.sourceAccountId ?? receivable.accountId;
    const effectiveSourceBudgetId = receivable.sourceBudgetId ?? receivable.budgetId;

    let sourceAccount: { id: string; workspaceId: string } | null = null;
    let sourceBudget: { id: string } | null = null;
    if (effectiveSourceAccountId) {
      const account = await prisma.financialAccount.findFirst({
        where: { id: effectiveSourceAccountId, kind: "BANK", isActive: true },
        select: { id: true, workspaceId: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Selected deduction account is invalid." }, { status: 400 });
      }
      await requireWorkspaceAccess(account.workspaceId, "EDITOR");
      sourceAccount = account;

      if (!effectiveSourceBudgetId) {
        return NextResponse.json(
          { error: "Selected deduction subaccount is invalid." },
          { status: 400 },
        );
      }
      const budget = await prisma.budgetEnvelope.findFirst({
        where: {
          id: effectiveSourceBudgetId,
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
    const idempotencyKey = getIdempotencyKey(request, `receivable-close:${receivable.id}`);
    const externalRef = `receivable-close:${receivable.id}:${idempotencyKey}`;
    const transactionTitle = receivable.title;
    const transactionNotes = receivable.notes ?? null;

    const posting = await executePosting({
      workspaceId: receivable.workspaceId,
      operation: "RECEIVABLE_CLOSE",
      idempotencyKey,
      actorUserId: userId,
      sourceType: "RECEIVABLE",
      sourceId: receivable.id,
      request: { receivableId: receivable.id, ...parsed.data },
    }, async (db, postingGroupId) => {
      await claimReceivable(db, receivable.id);

      const incomeTx = await createLedgerTransaction(db, postingGroupId, {
          workspaceId: targetWorkspaceId,
          accountId: targetAccount.id,
          kind: "RECEIVABLE_PAYMENT",
          direction: "CREDIT",
          budgetId: targetBudget.id,
          date: closeDate,
          amountCents: receivable.amountCents,
          subject: transactionTitle,
          // Receivable postings use notes as their only descriptive field. Keeping
          // details empty prevents legacy details-as-notes clients from showing
          // internal transfer metadata instead of the receivable notes.
          details: null,
          notes: transactionNotes,
          externalRef,
          receivableId: receivable.id,
          isSynced: false,
          isFromFamily: false,
      });

      let sourceTxId: string | null = null;
      let sourcePostingGroupId: string | null = null;
      const shouldCreateSourceDeduction =
        sourceAccount &&
        sourceBudget &&
        (sourceAccount.workspaceId !== targetAccount.workspaceId ||
          sourceAccount.id !== targetAccount.id ||
          sourceBudget.id !== targetBudget.id);

      if (shouldCreateSourceDeduction && sourceAccount && sourceBudget) {
        const sourceIsInReceivableWorkspace = sourceAccount.workspaceId === receivable.workspaceId;
        sourcePostingGroupId = sourceIsInReceivableWorkspace
          ? postingGroupId
          : await createPostingGroupRecord(db, {
              workspaceId: sourceAccount.workspaceId,
              operation: "RECEIVABLE_CLOSE_SOURCE",
              idempotencyKey,
              actorUserId: userId,
              sourceType: "RECEIVABLE",
              sourceId: receivable.id,
            });

        const sourceTx = await createLedgerTransaction(db, sourcePostingGroupId, {
            workspaceId: sourceAccount.workspaceId,
            accountId: sourceAccount.id,
            kind: "TRANSFER",
            direction: "DEBIT",
            budgetId: sourceBudget.id,
            date: closeDate,
            amountCents: receivable.amountCents,
            subject: transactionTitle,
            details: null,
            notes: transactionNotes,
            externalRef,
            receivableId: sourceIsInReceivableWorkspace ? receivable.id : null,
            isSynced: false,
            isFromFamily: false,
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

      await applyBudgetAvailableDelta(db, targetBudget.id, receivable.amountCents);
      if (shouldCreateSourceDeduction && sourceBudget) {
        await applyBudgetAvailableDelta(db, sourceBudget.id, -receivable.amountCents);
      }

      return {
        receivable: updatedReceivable,
        incomeTransactionId: incomeTx.id,
        sourceTransactionId: sourceTxId,
        sourcePostingGroupId,
      };
    });

    return NextResponse.json({
      ...posting.result,
      postingGroupId: posting.postingGroupId,
      replayed: posting.replayed,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to close receivable", message }, { status: 500 });
  }
}
