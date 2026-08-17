import { CorrectTransactionSchema } from "@/lib/domains/ledger/transaction-contracts";
import {
  correctLedgerTransaction,
  getIdempotencyKey,
  PostingConflictError,
} from "@/lib/domains/ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

const CORRECTION_VALIDATION_ERRORS = new Set([
  "A transaction group requires a selected sub-account.",
  "Selected sub-account does not belong to this transaction account.",
  "Selected group does not belong to this sub-account.",
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = CorrectTransactionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const { userId } = await requireWorkspaceAccess(existing.workspaceId, "EDITOR");
    const { reason: suppliedReason, date, ...replacement } = parsed.data;
    const reason = suppliedReason || "User corrected transaction";
    const posting = await correctLedgerTransaction({
      transactionId: existing.id,
      actorUserId: userId,
      reason,
      idempotencyKey: getIdempotencyKey(request),
      replacement: {
        ...replacement,
        ...(date ? { date: new Date(date) } : {}),
      },
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
    if (CORRECTION_VALIDATION_ERRORS.has(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to correct transaction", message }, { status: 500 });
  }
}
