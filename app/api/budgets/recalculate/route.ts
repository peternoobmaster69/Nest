import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const RecalculateSchema = z.object({
  workspaceId: z.string().min(1),
  budgetId: z.string().optional(),
  accountId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = RecalculateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, budgetId, accountId } = parsed.data;

    await requireWorkspaceAccess(workspaceId, "EDITOR");

    // Build where clause
    const where: { workspaceId: string; isActive: boolean; id?: string; accountId?: string } = {
      workspaceId,
      isActive: true,
    };

    if (budgetId) {
      where.id = budgetId;
    }
    if (accountId) {
      where.accountId = accountId;
    }

    // Get budgets to recalculate
    const budgets = await prisma.budgetEnvelope.findMany({
      where,
      select: { id: true, name: true, availableCents: true },
    });

    if (budgets.length === 0) {
      return NextResponse.json({ error: "No budgets found to recalculate" }, { status: 404 });
    }

    const results: Array<{
      id: string;
      name: string;
      previousCents: number;
      newCents: number;
      difference: number;
    }> = [];

    // Recalculate each budget
    for (const budget of budgets) {
      const previousCents = budget.availableCents;
      const updated = await recalculateBudgetAvailableCents(prisma, workspaceId, budget.id);
      const newCents = updated.availableCents;

      results.push({
        id: budget.id,
        name: budget.name,
        previousCents,
        newCents,
        difference: newCents - previousCents,
      });
    }

    return NextResponse.json({
      success: true,
      recalculated: budgets.length,
      budgets: results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to recalculate budgets", message }, { status: 500 });
  }
}
