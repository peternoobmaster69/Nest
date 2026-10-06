import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

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
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const { workspaceId, budgetId, accountId } = parsed.data;

    const { userId } = await requireWorkspaceAccess(workspaceId, "EDITOR");
    await enforceDistributedRateLimit(request, {
      scope: "budget-recalculate",
      identifier: `${workspaceId}:${userId}`,
      limit: 5,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });

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
      take: 500,
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
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: "Failed to recalculate budgets" }, { status: 500 });
  }
}
