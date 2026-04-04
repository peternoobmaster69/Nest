import { prisma } from "@/lib/prisma";
import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
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
  id: z.string().optional(),
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

const AddMonthlyAllocationSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  budgetItemId: z.string(),
  budgetSourceId: z.string(),
  allocatedCents: z.number().int().min(0),
});

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
  id: z.string().optional(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  budgetItemId: z.string(),
  budgetSourceId: z.string(),
  allocatedCents: z.number().int().min(0),
});

const DeleteAllocationSchema = z.object({
  workspaceId: z.string(),
  action: z.literal("deleteAllocation"),
  id: z.string(),
});

function monthDate(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
}

function allocationKey(budgetItemId: string, budgetSourceId: string) {
  return `${budgetItemId}::${budgetSourceId}`;
}

function distributeItemAcrossSources(
  itemAmountCents: number,
  sources: Array<{ id: string; amountCents: number }>,
  totalSourceCents: number,
) {
  const positiveSources = sources.filter((source) => source.amountCents > 0);
  if (itemAmountCents <= 0 || totalSourceCents <= 0 || positiveSources.length === 0) {
    return [] as Array<{ budgetSourceId: string; allocatedCents: number }>;
  }

  let allocatedSoFar = 0;
  return positiveSources
    .map((source, index) => {
      const allocatedCents =
        index === positiveSources.length - 1
          ? itemAmountCents - allocatedSoFar
          : Math.round((itemAmountCents * source.amountCents) / totalSourceCents);
      allocatedSoFar += allocatedCents;
      return {
        budgetSourceId: source.id,
        allocatedCents,
      };
    })
    .filter((entry) => entry.allocatedCents > 0);
}

async function ensureMonthIsNotConfirmed(workspaceId: string, year: number, month: number) {
  const confirmedCount = await prisma.monthlyBudget.count({
    where: { workspaceId, year, month, isDraft: false },
  });
  if (confirmedCount > 0) {
    return NextResponse.json(
      { error: `The monthly budget for ${month}/${year} has already been approved.` },
      { status: 409 },
    );
  }
  return null;
}

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

    const budgetItems = await prisma.budgetItem.findMany({
      where: { workspaceId, isActive: true },
      include: {
        destinationSubAccount: {
          select: { id: true, name: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    const budgetSources = await prisma.budgetSource.findMany({
      where: { workspaceId, isActive: true },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    let monthlyBudgets: Awaited<ReturnType<typeof prisma.monthlyBudget.findMany>> = [];
    if (year && month) {
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10);
      monthlyBudgets = await prisma.monthlyBudget.findMany({
        where: {
          workspaceId,
          year: yearNum,
          month: monthNum,
        },
        include: {
          budgetItem: {
            select: { id: true, title: true },
          },
          budgetSource: {
            select: { id: true, title: true },
          },
        },
        orderBy: [
          { isDraft: "desc" },
          { budgetItemTitle: "asc" },
          { budgetSourceTitle: "asc" },
          { createdAt: "asc" },
        ],
      });
    }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

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
      const alreadyConfirmed = await ensureMonthIsNotConfirmed(body.workspaceId, year, month);
      if (alreadyConfirmed) {
        return alreadyConfirmed;
      }

      const budgetItems = await prisma.budgetItem.findMany({
        where: { workspaceId: body.workspaceId, isActive: true, isMonthly: true },
        orderBy: { sortOrder: "asc" },
      });

      const budgetSources = await prisma.budgetSource.findMany({
        where: { workspaceId: body.workspaceId, isActive: true },
        orderBy: { createdAt: "asc" },
      });

      if (budgetItems.length === 0 || budgetSources.length === 0) {
        return NextResponse.json({ error: "Need at least one budget item and one source" }, { status: 400 });
      }

      const totalSourceCents = budgetSources.reduce((sum, source) => sum + source.amountCents, 0);
      const totalBudgetCents = budgetItems.reduce((sum, item) => sum + item.amountCents, 0);

      await prisma.monthlyBudget.deleteMany({
        where: { workspaceId: body.workspaceId, year, month, isDraft: true },
      });

      const generatedMonthlyBudgets = [];
      for (const item of budgetItems) {
        for (const sourceAllocation of distributeItemAcrossSources(item.amountCents, budgetSources, totalSourceCents)) {
          const source = budgetSources.find((entry) => entry.id === sourceAllocation.budgetSourceId);
          if (!source) continue;

          const monthlyBudget = await prisma.monthlyBudget.create({
            data: {
              workspaceId: body.workspaceId,
              budgetItemId: item.id,
              budgetSourceId: source.id,
              year,
              month,
              budgetItemTitle: item.title,
              budgetSourceTitle: source.title,
              destinationSubAccountId: item.destinationSubAccountId,
              allocatedCents: sourceAllocation.allocatedCents,
              isDraft: true,
            },
          });
          generatedMonthlyBudgets.push(monthlyBudget);
        }
      }

      return NextResponse.json({
        generated: generatedMonthlyBudgets.length,
        totalSourceCents,
        totalBudgetCents,
        monthlyBudgets: generatedMonthlyBudgets,
      });
    }

    if (action === "addAllocation") {
      const parsed = AddMonthlyAllocationSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { year, month, budgetItemId, budgetSourceId, allocatedCents } = parsed.data;
      const alreadyConfirmed = await ensureMonthIsNotConfirmed(body.workspaceId, year, month);
      if (alreadyConfirmed) {
        return alreadyConfirmed;
      }

      const [budgetItem, budgetSource] = await Promise.all([
        prisma.budgetItem.findFirst({
          where: { workspaceId: body.workspaceId, id: budgetItemId, isActive: true },
          select: { id: true, title: true, destinationSubAccountId: true },
        }),
        prisma.budgetSource.findFirst({
          where: { workspaceId: body.workspaceId, id: budgetSourceId, isActive: true },
          select: { id: true, title: true },
        }),
      ]);

      if (!budgetItem || !budgetSource) {
        return NextResponse.json({ error: "Selected template item or source is invalid." }, { status: 400 });
      }

      const monthlyBudget = await prisma.monthlyBudget.upsert({
        where: {
          workspaceId_year_month_budgetItemId_budgetSourceId: {
            workspaceId: body.workspaceId,
            year,
            month,
            budgetItemId,
            budgetSourceId,
          },
        },
        create: {
          workspaceId: body.workspaceId,
          budgetItemId,
          budgetSourceId,
          year,
          month,
          budgetItemTitle: budgetItem.title,
          budgetSourceTitle: budgetSource.title,
          destinationSubAccountId: budgetItem.destinationSubAccountId,
          allocatedCents,
          isDraft: true,
        },
        update: {
          budgetItemTitle: budgetItem.title,
          budgetSourceTitle: budgetSource.title,
          destinationSubAccountId: budgetItem.destinationSubAccountId,
          allocatedCents,
          isDraft: true,
        },
      });

      return NextResponse.json(monthlyBudget);
    }

    if (action === "cancelDraft") {
      const { year, month } = body;
      await requireWorkspaceAccess(body.workspaceId);

      const deleted = await prisma.monthlyBudget.deleteMany({
        where: { workspaceId: body.workspaceId, year, month, isDraft: true },
      });

      return NextResponse.json({ deleted: deleted.count });
    }

    if (action === "confirmMonthly") {
      const parsed = ConfirmMonthlyBudgetSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { year, month, allocations, applyToSubAccounts } = parsed.data;

      const result = await prisma.$transaction(async (db) => {
        const currentRows = await db.monthlyBudget.findMany({
          where: { workspaceId: body.workspaceId, year, month },
          orderBy: { createdAt: "asc" },
        });

        if (currentRows.length === 0) {
          throw new Error("No monthly budget draft exists for this month.");
        }

        if (currentRows.some((row) => !row.isDraft)) {
          throw new Error("This monthly budget has already been approved.");
        }

        const allocationMap = new Map(
          allocations.map((allocation) => [allocationKey(allocation.budgetItemId, allocation.budgetSourceId), allocation]),
        );

        const toDeleteIds: string[] = [];
        const toConfirm = [];
        for (const row of currentRows) {
          const allocation = allocationMap.get(allocationKey(row.budgetItemId, row.budgetSourceId));
          if (!allocation || allocation.allocatedCents <= 0) {
            toDeleteIds.push(row.id);
            continue;
          }
          toConfirm.push({
            ...row,
            allocatedCents: allocation.allocatedCents,
            budgetItemTitle: allocation.budgetItemTitle || row.budgetItemTitle,
            budgetSourceTitle: allocation.budgetSourceTitle || row.budgetSourceTitle,
          });
        }

        if (toConfirm.length === 0) {
          throw new Error("At least one monthly allocation must remain before approval.");
        }

        if (toDeleteIds.length > 0) {
          await db.monthlyBudget.deleteMany({
            where: { workspaceId: body.workspaceId, id: { in: toDeleteIds } },
          });
        }

        const destinationBudgetIds = [
          ...new Set(toConfirm.map((row) => row.destinationSubAccountId).filter((value): value is string => Boolean(value))),
        ];
        const destinationBudgets = destinationBudgetIds.length
          ? await db.budgetEnvelope.findMany({
              where: { workspaceId: body.workspaceId, id: { in: destinationBudgetIds }, isActive: true },
              select: { id: true, accountId: true },
            })
          : [];
        const destinationBudgetById = new Map(destinationBudgets.map((budget) => [budget.id, budget]));
        const applyTimestamp = new Date();

        for (const row of toConfirm) {
          await db.monthlyBudget.update({
            where: { id: row.id },
            data: {
              allocatedCents: row.allocatedCents,
              budgetItemTitle: row.budgetItemTitle,
              budgetSourceTitle: row.budgetSourceTitle,
              isDraft: false,
              confirmedAt: applyTimestamp,
              appliedAt:
                applyToSubAccounts && row.destinationSubAccountId && row.allocatedCents > 0 ? applyTimestamp : null,
            },
          });

          if (!applyToSubAccounts || !row.destinationSubAccountId || row.allocatedCents <= 0) {
            continue;
          }

          const destinationBudget = destinationBudgetById.get(row.destinationSubAccountId);
          if (!destinationBudget) {
            throw new Error(`Destination sub-account is missing for "${row.budgetItemTitle ?? "budget item"}".`);
          }

          await db.transaction.create({
            data: {
              workspaceId: body.workspaceId,
              accountId: destinationBudget.accountId,
              budgetId: destinationBudget.id,
              kind: "ADJUSTMENT",
              direction: "CREDIT",
              date: monthDate(year, month),
              amountCents: row.allocatedCents,
              subject: `Monthly budget allocation: ${row.budgetItemTitle ?? "Budget item"}`,
              details: `Approved budget for ${month}/${year} funded by ${row.budgetSourceTitle ?? "source"}`,
            },
          });
        }

        for (const budgetId of destinationBudgetById.keys()) {
          await recalculateBudgetAvailableCents(db, body.workspaceId, budgetId);
        }

        return {
          confirmed: toConfirm.length,
          appliedToSubAccounts: applyToSubAccounts,
        };
      });

      return NextResponse.json(result);
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
    const type = searchParams.get("type");

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
      return NextResponse.json({ success: true });
    }

    if (type === "source") {
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
      return NextResponse.json({ success: true });
    }

    if (type === "allocation") {
      const parsed = DeleteAllocationSchema.safeParse({
        workspaceId: searchParams.get("workspaceId"),
        action: "deleteAllocation",
        id,
      });
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(parsed.data.workspaceId);
      const allocation = await prisma.monthlyBudget.findUnique({
        where: { id: parsed.data.id },
        select: { workspaceId: true, isDraft: true },
      });
      if (!allocation || allocation.workspaceId !== parsed.data.workspaceId) {
        return NextResponse.json({ error: "Monthly allocation not found" }, { status: 404 });
      }
      if (!allocation.isDraft) {
        return NextResponse.json({ error: "Approved monthly allocations cannot be removed." }, { status: 409 });
      }

      await prisma.monthlyBudget.delete({
        where: { id: parsed.data.id },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete budget", message }, { status: 500 });
  }
}

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
      const { id, year, month, budgetItemId, budgetSourceId, allocatedCents } = parsed.data;
      const alreadyConfirmed = await ensureMonthIsNotConfirmed(body.workspaceId, year, month);
      if (alreadyConfirmed) {
        return alreadyConfirmed;
      }

      const where = id
        ? { id }
        : {
            workspaceId_year_month_budgetItemId_budgetSourceId: {
              workspaceId: body.workspaceId,
              year,
              month,
              budgetItemId,
              budgetSourceId,
            },
          };

      const updated = await prisma.monthlyBudget.update({
        where,
        data: { allocatedCents },
      });

      return NextResponse.json(updated);
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
