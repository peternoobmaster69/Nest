import { readTransactionLineage } from "@/lib/domains/ledger/transaction-lineage";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      select: { workspaceId: true, kind: true, voidedAt: true },
    });
    if (!transaction || transaction.voidedAt || transaction.kind === "REVERSAL") {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(transaction.workspaceId);
    const lineage = await readTransactionLineage({
      transactionId: id,
      workspaceId: transaction.workspaceId,
    });
    return NextResponse.json(lineage);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load transaction history" }, { status: 500 });
  }
}
