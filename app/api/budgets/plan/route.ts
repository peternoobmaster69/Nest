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

const ApproveBudgetItemSchema = z.object({
  monthlyBudgetId: z.string(),
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
        where: {
          workspaceId,
          year: yearNum,
          month: monthNum,
          // Only include budgets where both the item and source are still active
          budgetItem: { isActive: true },
          budgetSource: { isActive: true },
        },
        include: {
          budgetItem: {
            select: { id: true, title: true, destinationSubAccountId: true },
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
        include: {
          destinationSubAccount: {
            select: { id: true, name: true },
          },
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
        include: {
          owner: {
            select: { id: true, name: true, email: true },
          },
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

      // Generate monthly budgets
      // Create allocation records for each item/source combination
      // Use template amount as initial allocatedCents (user can edit manually)
      const generatedMonthlyBudgets = [];
      for (const item of budgetItems) {
        if (item.amountCents === 0) continue;

        for (const source of budgetSources) {
          if (source.amountCents === 0) continue;

          // Use the budget item amount as the initial allocation
          // User will manually adjust this to their exact desired amount
          const allocatedCents = item.amountCents;

          // Check if record already exists
          const existing = await prisma.monthlyBudget.findFirst({
            where: {
              workspaceId: body.workspaceId,
              budgetItemId: item.id,
              budgetSourceId: source.id,
              year,
              month,
            },
          });

          if (existing) {
            // Update existing record, keeping current allocatedCents
            generatedMonthlyBudgets.push(existing);
          } else {
            // Create new record with template amount as initial allocation
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

    if (action === "cancelDraft") {
      const { year, month } = body;
      await requireWorkspaceAccess(body.workspaceId);

      // Delete draft monthly budgets for this month
      const deleted = await prisma.monthlyBudget.deleteMany({
        where: { workspaceId: body.workspaceId, year, month, isDraft: true },
      });

      return NextResponse.json({ deleted: deleted.count });
    }

    if (action === "approveItem") {
      const parsed = ApproveBudgetItemSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { monthlyBudgetId } = parsed.data;

      // Get the monthly budget with its associated budget item
      const monthlyBudget = await prisma.monthlyBudget.findUnique({
        where: { id: monthlyBudgetId },
        include: {
          budgetItem: {
            select: { id: true, destinationSubAccountId: true },
          },
        },
      });

      if (!monthlyBudget) {
        return NextResponse.json({ error: "Monthly budget not found" }, { status: 404 });
      }

      if (monthlyBudget.workspaceId !== body.workspaceId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      // Check if already applied to sub-account (prevent duplicates)
      if (monthlyBudget.isAppliedToSubAccount) {
        return NextResponse.json({ error: "Already approved and applied to sub-account" }, { status: 409 });
      }

      // Check if it has a destination sub-account
      if (!monthlyBudget.budgetItem.destinationSubAccountId) {
        return NextResponse.json({ error: "No destination sub-account configured for this budget item" }, { status: 400 });
      }

      // We already verified destinationSubAccountId exists above
      const destinationSubAccountId = monthlyBudget.budgetItem.destinationSubAccountId!;

      // Apply the allocated amount to the destination sub-account
      await prisma.$transaction(async (tx) => {
        // Update the monthly budget to mark as applied
        await tx.monthlyBudget.update({
          where: { id: monthlyBudgetId },
          data: {
            isAppliedToSubAccount: true,
            appliedAt: new Date(),
          },
        });

        // Add the allocated amount to the destination sub-account
        await tx.budgetEnvelope.update({
          where: { id: destinationSubAccountId },
          data: {
            availableCents: { increment: monthlyBudget.allocatedCents },
          },
        });
      });

      return NextResponse.json({
        success: true,
        appliedCents: monthlyBudget.allocatedCents,
        destinationSubAccountId: destinationSubAccountId,
      });
    }

    if (action === "confirmMonthly") {
      const parsed = ConfirmMonthlyBudgetSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { year, month, allocations, applyToSubAccounts } = parsed.data;

      const itemIds = [...new Set(allocations.map((alloc) => alloc.budgetItemId))];
      const sourceIds = [...new Set(allocations.map((alloc) => alloc.budgetSourceId))];
      const items = await prisma.budgetItem.findMany({
        where: { workspaceId: body.workspaceId, id: { in: itemIds }, isActive: true },
        select: { id: true, destinationSubAccountId: true },
      });
      const itemById = new Map(items.map((item) => [item.id, item]));

      const sources = await prisma.budgetSource.findMany({
        where: { workspaceId: body.workspaceId, id: { in: sourceIds }, isActive: true },
        select: { id: true },
      });
      const sourceIdsSet = new Set(sources.map((source) => source.id));

      // Update draft budgets to confirmed
      const confirmedBudgets = [];
      for (const alloc of allocations) {
        const budgetItem = itemById.get(alloc.budgetItemId);
        if (!budgetItem) continue;
        if (!sourceIdsSet.has(alloc.budgetSourceId)) continue;

        // Find the existing monthly budget record
        const existingMonthlyBudget = await prisma.monthlyBudget.findFirst({
          where: {
            workspaceId: body.workspaceId,
            budgetItemId: alloc.budgetItemId,
            budgetSourceId: alloc.budgetSourceId,
            year,
            month,
          },
        });

        if (!existingMonthlyBudget) continue;

        // Update the draft record with new amount and mark as confirmed
        await prisma.monthlyBudget.update({
          where: {
            id: existingMonthlyBudget.id,
          },
          data: {
            allocatedCents: alloc.allocatedCents,
            isDraft: false,
            confirmedAt: new Date(),
          },
        });
        confirmedBudgets.push(existingMonthlyBudget.id);

        // Apply to sub-accounts if requested and not already applied
        if (applyToSubAccounts && budgetItem.destinationSubAccountId && !existingMonthlyBudget.isAppliedToSubAccount) {
          await prisma.budgetEnvelope.update({
            where: { id: budgetItem.destinationSubAccountId },
            data: {
              availableCents: { increment: alloc.allocatedCents },
            },
          });

          // Also mark the monthly budget as applied to prevent duplicate additions
          await prisma.monthlyBudget.update({
            where: {
              id: existingMonthlyBudget.id,
            },
            data: {
              isAppliedToSubAccount: true,
              appliedAt: new Date(),
            },
          });
        }
      }

      // Delete any remaining drafts for this month (in case some were removed)
      await prisma.monthlyBudget.deleteMany({
        where: { workspaceId: body.workspaceId, year, month, isDraft: true },
      });

      return NextResponse.json({
        confirmed: confirmedBudgets.length,
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

const UpdateBudgetItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  amountCents: z.number().int().min(0),
  isMonthly: z.boolean().default(true),
  destinationSubAccountId: z.string().optional().nullable(),
});

const UpdateBudgetSourceSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  ownerId: z.string().min(1, "Owner is required"),
  amountCents: z.number().int().min(0),
});

const UpdateAllocationSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  budgetItemId: z.string(),
  budgetSourceId: z.string(),
  allocatedCents: z.number().int().min(0),
});

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    await requireSessionUserId();

    if (action === "updateItem") {
      const parsed = UpdateBudgetItemSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const { id, title, amountCents, isMonthly, destinationSubAccountId } = parsed.data;

      const existing = await prisma.budgetItem.findUnique({
        where: { id },
        select: { workspaceId: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "Budget item not found" }, { status: 404 });
      }
      await requireWorkspaceAccess(existing.workspaceId);

      const updated = await prisma.budgetItem.update({
        where: { id },
        data: { title, amountCents, isMonthly, destinationSubAccountId },
      });

      return NextResponse.json(updated);
    }

    if (action === "updateSource") {
      const parsed = UpdateBudgetSourceSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      const { id, title, ownerId, amountCents } = parsed.data;

      const existing = await prisma.budgetSource.findUnique({
        where: { id },
        select: { workspaceId: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "Budget source not found" }, { status: 404 });
      }
      await requireWorkspaceAccess(existing.workspaceId);

      const updated = await prisma.budgetSource.update({
        where: { id },
        data: { title, ownerId, amountCents },
      });

      return NextResponse.json(updated);
    }

    if (action === "updateAllocation") {
      const parsed = UpdateAllocationSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { year, month, budgetItemId, budgetSourceId, allocatedCents } = parsed.data;

      await prisma.monthlyBudget.updateMany({
        where: {
          workspaceId: body.workspaceId,
          year,
          month,
          budgetItemId,
          budgetSourceId,
        },
        data: { allocatedCents },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update budget", message }, { status: 500 });
  }
}
