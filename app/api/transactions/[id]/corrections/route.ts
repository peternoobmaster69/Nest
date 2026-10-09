import { runSecureApiRoute } from "@/lib/api-security";
import { CorrectTransactionSchema } from "@/lib/domains/ledger/transaction-contracts";
import { correctLedgerTransaction, getIdempotencyKey } from "@/lib/domains/ledger";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to correct transaction" }, async () => {
    const { id } = await params;
    const parsed = CorrectTransactionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
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
  });
}
