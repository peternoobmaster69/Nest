import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess, requireSessionUserId, ApiAuthError } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateBudgetItemSchema = z.object({
  title: z.string().min(1).max(200),
  amountCents: z.number().int().min(0),
  isMonthly: z.boolean().default(true),
  destinationSubAccountId: z.string().optional().nullable(),
});

const CreateBudgetSourceSchema = z.object({
  title: z.string().min(1).max(200),
  ownerId: z.string().min(1, "Owner is required"),
  amountCents: z.number().int().min(0),
});

const GenerateMonthlyBudgetSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
});

const AllocationItemSchema = z.object({
  budgetItemId: z.string(),
  budgetItemTitle: z.string(),
  budgetSourceId: z.string(),
  budgetSourceTitle: z.string(),
  allocatedCents: z.number().int().min(0),
});

const ConfirmMonthlyBudgetSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  allocations: z.array(AllocationItemSchema).min(1, "At least one allocation is required"),
  applyToSubAccounts: z.boolean().default(false),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const year = searchParams.get("year");
    const month = searchParams.get("month");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    // Get all budget items
    const budgetItems = await prisma.budgetItem.findMany({
      where: { workspaceId, isActive: true },
      include: {
        destinationSubAccount: {
          select: { id: true, name: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    // Get all budget sources
    const budgetSources = await prisma.budgetSource.findMany({
      where: { workspaceId, isActive: true },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Get monthly budget allocations if year/month provided
    let monthlyBudgets: Awaited<ReturnType<typeof prisma.monthlyBudget.findMany>> = [];
    if (year && month) {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      monthlyBudgets = await prisma.monthlyBudget.findMany({
        where: { workspaceId, year: yearNum, month: monthNum },
        include: {
          budgetItem: {
            select: { id: true, title: true },
          },
          budgetSource: {
            select: { id: true, title: true },
          },
        },
      });
    }

    // Get workspace members for source owner selection
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Get sub-accounts for destination selection
    const subAccounts = await prisma.budgetEnvelope.findMany({
      where: { workspaceId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      budgetItems,
      budgetSources,
      monthlyBudgets,
      members,
      subAccounts,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load budgets", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    await requireSessionUserId();

    if (action === "createItem") {
      const parsed = CreateBudgetItemSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);

      const item = await prisma.budgetItem.create({
        data: {
          workspaceId: body.workspaceId,
          title: parsed.data.title,
          amountCents: parsed.data.amountCents,
          isMonthly: parsed.data.isMonthly,
          destinationSubAccountId: parsed.data.destinationSubAccountId,
        },
      });

      return NextResponse.json(item);
    }

    if (action === "createSource") {
      const parsed = CreateBudgetSourceSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);

      const source = await prisma.budgetSource.create({
        data: {
          workspaceId: body.workspaceId,
          title: parsed.data.title,
          ownerId: parsed.data.ownerId,
          amountCents: parsed.data.amountCents,
        },
      });

      return NextResponse.json(source);
    }

    if (action === "generateMonthly") {
      const parsed = GenerateMonthlyBudgetSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);

      const { year, month } = parsed.data;

      // Get active budget items
      const budgetItems = await prisma.budgetItem.findMany({
        where: { workspaceId: body.workspaceId, isActive: true },
      });

      // Get active budget sources
      const budgetSources = await prisma.budgetSource.findMany({
        where: { workspaceId: body.workspaceId, isActive: true },
      });

      if (budgetItems.length === 0 || budgetSources.length === 0) {
        return NextResponse.json({ error: "Need at least one budget item and one source" }, { status: 400 });
      }

      // Calculate total source amount
      const totalSourceCents = budgetSources.reduce((sum, s) => sum + s.amountCents, 0);

      // Calculate total budget item amount
      const totalBudgetCents = budgetItems.reduce((sum, i) => sum + i.amountCents, 0);

      // Delete existing monthly budgets for this month
      await prisma.monthlyBudget.deleteMany({
        where: { workspaceId: body.workspaceId, year, month },
      });

      // Generate monthly budgets
      // Distribute each budget item's amount proportionally across sources
      const generatedMonthlyBudgets = [];
      for (const item of budgetItems) {
        // Skip items with 0 amount
        if (item.amountCents === 0) continue;

        // Distribute across sources proportionally
        for (const source of budgetSources) {
          if (source.amountCents === 0) continue;

          // Source's proportion of total
          const sourceProportion = totalSourceCents > 0 ? source.amountCents / totalSourceCents : 0;

          // Calculate allocation: item amount * source proportion
          // This ensures all allocations sum to total source amount
          const allocatedCents = Math.round(item.amountCents * sourceProportion);

          if (allocatedCents > 0) {
            const monthlyBudget = await prisma.monthlyBudget.create({
              data: {
                workspaceId: body.workspaceId,
                budgetItemId: item.id,
                budgetSourceId: source.id,
                year,
                month,
                allocatedCents,
              },
            });
            generatedMonthlyBudgets.push(monthlyBudget);
          }
        }
      }

      return NextResponse.json({
        generated: generatedMonthlyBudgets.length,
        totalSourceCents,
        totalBudgetCents,
        monthlyBudgets: generatedMonthlyBudgets,
      });
    }

    if (action === "confirmMonthly") {
      const parsed = ConfirmMonthlyBudgetSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const { userId } = await requireWorkspaceAccess(body.workspaceId);
      const { year, month, allocations, applyToSubAccounts } = parsed.data;

      // Delete existing monthly budgets for this month
      await prisma.monthlyBudget.deleteMany({
        where: { workspaceId: body.workspaceId, year, month },
      });

      // Create new monthly budgets from the confirmed allocations
      const createdBudgets = [];
      for (const alloc of allocations) {
        const monthlyBudget = await prisma.monthlyBudget.create({
          data: {
            workspaceId: body.workspaceId,
            budgetItemId: alloc.budgetItemId,
            budgetSourceId: alloc.budgetSourceId,
            year,
            month,
            allocatedCents: alloc.allocatedCents,
          },
        });
        createdBudgets.push(monthlyBudget);

        // If requested, add funds to destination sub-account based on budget item
        if (applyToSubAccounts && alloc.allocatedCents > 0) {
          const budgetItem = await prisma.budgetItem.findUnique({
            where: { id: alloc.budgetItemId },
            select: { destinationSubAccountId: true },
          });

          if (budgetItem?.destinationSubAccountId) {
            // Add allocated amount to the sub-account
            await prisma.budgetEnvelope.update({
              where: { id: budgetItem.destinationSubAccountId },
              data: {
                availableCents: { increment: alloc.allocatedCents },
              },
            });
          }
        }
      }

      return NextResponse.json({
        created: createdBudgets.length,
        monthlyBudgets: createdBudgets,
        appliedToSubAccounts: applyToSubAccounts,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to process budget request", message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const type = searchParams.get("type"); // "item" or "source"

    if (!id || !type) {
      return NextResponse.json({ error: "id and type are required" }, { status: 400 });
    }

    await requireSessionUserId();

    if (type === "item") {
      const item = await prisma.budgetItem.findUnique({
        where: { id },
        select: { workspaceId: true },
      });
      if (!item) {
        return NextResponse.json({ error: "Budget item not found" }, { status: 404 });
      }
      await requireWorkspaceAccess(item.workspaceId);

      await prisma.budgetItem.update({
        where: { id },
        data: { isActive: false },
      });
    } else if (type === "source") {
      const source = await prisma.budgetSource.findUnique({
        where: { id },
        select: { workspaceId: true },
      });
      if (!source) {
        return NextResponse.json({ error: "Budget source not found" }, { status: 404 });
      }
      await requireWorkspaceAccess(source.workspaceId);

      await prisma.budgetSource.update({
        where: { id },
        data: { isActive: false },
      });
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete budget", message }, { status: 500 });
  }
}
