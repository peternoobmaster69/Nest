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

const CreateMonthlyBudgetSourceSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
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

const UpdateMonthlyBudgetSourceSchema = z.object({
  id: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
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

function allocateItemWithinRemainingSources(
  itemAmountCents: number,
  remainingBySourceId: Map<string, number>,
  sources: Array<{ budgetSourceId: string }>,
) {
  const availableSources = sources
    .map((source) => ({
      budgetSourceId: source.budgetSourceId,
      remainingCents: remainingBySourceId.get(source.budgetSourceId) ?? 0,
    }))
    .filter((source) => source.remainingCents > 0);

  const totalRemainingCents = availableSources.reduce((sum, source) => sum + source.remainingCents, 0);
  const targetCents = Math.min(Math.max(0, itemAmountCents), totalRemainingCents);

  if (targetCents <= 0 || availableSources.length === 0) {
    return [] as Array<{ budgetSourceId: string; allocatedCents: number }>;
  }

  let allocatedSoFar = 0;
  const allocations = availableSources
    .map((source, index) => {
      const allocatedCents =
        index === availableSources.length - 1
          ? targetCents - allocatedSoFar
          : Math.min(
              source.remainingCents,
              Math.round((targetCents * source.remainingCents) / totalRemainingCents),
            );
      allocatedSoFar += allocatedCents;
      return {
        budgetSourceId: source.budgetSourceId,
        allocatedCents,
      };
    })
    .filter((entry) => entry.allocatedCents > 0);

  const shortfall = targetCents - allocations.reduce((sum, entry) => sum + entry.allocatedCents, 0);
  if (shortfall > 0) {
    for (const source of availableSources) {
      const currentRemaining = remainingBySourceId.get(source.budgetSourceId) ?? 0;
      const alreadyAllocated =
        allocations.find((entry) => entry.budgetSourceId === source.budgetSourceId)?.allocatedCents ?? 0;
      const extraCapacity = currentRemaining - alreadyAllocated;
      if (extraCapacity <= 0) continue;
      const extra = Math.min(extraCapacity, targetCents - allocations.reduce((sum, entry) => sum + entry.allocatedCents, 0));
      if (extra <= 0) break;
      const existing = allocations.find((entry) => entry.budgetSourceId === source.budgetSourceId);
      if (existing) {
        existing.allocatedCents += extra;
      } else {
        allocations.push({ budgetSourceId: source.budgetSourceId, allocatedCents: extra });
      }
    }
  }

  for (const allocation of allocations) {
    remainingBySourceId.set(
      allocation.budgetSourceId,
      Math.max(0, (remainingBySourceId.get(allocation.budgetSourceId) ?? 0) - allocation.allocatedCents),
    );
  }

  return allocations.filter((entry) => entry.allocatedCents > 0);
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

async function ensureMonthlyBudgetSources(workspaceId: string, year: number, month: number) {
  const [templateSources, existingMonthlySources] = await Promise.all([
    prisma.budgetSource.findMany({
      where: { workspaceId, isActive: true },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.monthlyBudgetSource.findMany({
      where: { workspaceId, year, month },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const existingByTemplateId = new Set(existingMonthlySources.map((source) => source.budgetSourceId));
  const missingTemplateSources = templateSources.filter((source) => !existingByTemplateId.has(source.id));

  if (missingTemplateSources.length === 0) {
    return existingMonthlySources;
  }

  const created = await Promise.all(
    missingTemplateSources.map((source) =>
      prisma.monthlyBudgetSource.create({
        data: {
          workspaceId,
          budgetSourceId: source.id,
          year,
          month,
          title: source.title,
          ownerId: source.ownerId,
          amountCents: source.amountCents,
          isDraft: true,
        },
        include: {
          owner: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
    ),
  );

  return [...existingMonthlySources, ...created].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
    let monthlyBudgetSources: Awaited<ReturnType<typeof prisma.monthlyBudgetSource.findMany>> = [];
    if (year && month) {
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10);
      monthlyBudgetSources = await ensureMonthlyBudgetSources(workspaceId, yearNum, monthNum);
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
          { budgetItem: { title: "asc" } },
          { budgetSource: { title: "asc" } },
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
      monthlyBudgetSources,
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

    if (action === "createMonthlySource") {
      const parsed = CreateMonthlyBudgetSourceSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { year, month, title, ownerId, amountCents } = parsed.data;
      const alreadyConfirmed = await ensureMonthIsNotConfirmed(body.workspaceId, year, month);
      if (alreadyConfirmed) {
        return alreadyConfirmed;
      }

      const created = await prisma.$transaction(async (db) => {
        const templateSource = await db.budgetSource.create({
          data: {
            workspaceId: body.workspaceId,
            title,
            ownerId,
            amountCents,
          },
        });

        return db.monthlyBudgetSource.create({
          data: {
            workspaceId: body.workspaceId,
            budgetSourceId: templateSource.id,
            year,
            month,
            title,
            ownerId,
            amountCents,
            isDraft: true,
          },
          include: {
            owner: {
              select: { id: true, name: true, email: true },
            },
            budgetSource: {
              select: { id: true, title: true },
            },
          },
        });
      });

      return NextResponse.json(created);
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

      const monthlyBudgetSources = await ensureMonthlyBudgetSources(body.workspaceId, year, month);

      if (budgetItems.length === 0 || monthlyBudgetSources.length === 0) {
        return NextResponse.json({ error: "Need at least one budget item and one source" }, { status: 400 });
      }

      const totalSourceCents = monthlyBudgetSources.reduce((sum, source) => sum + source.amountCents, 0);
      const totalBudgetCents = budgetItems.reduce((sum, item) => sum + item.amountCents, 0);
      const remainingBySourceId = new Map(monthlyBudgetSources.map((source) => [source.budgetSourceId, source.amountCents]));

      // Create ONE allocation per budget item with template amount
      // User will manually adjust amounts and add more allocations if needed
      const generatedMonthlyBudgets = [];
      for (const item of budgetItems) {
        // Use first source as default
        const defaultSource = monthlyBudgetSources[0];
        if (!defaultSource) continue;

        const monthlyBudget = await prisma.monthlyBudget.create({
          data: {
            workspaceId: body.workspaceId,
            budgetItemId: item.id,
            budgetSourceId: defaultSource.budgetSourceId,
            year,
            month,
            budgetItemTitle: item.title,
            budgetSourceTitle: defaultSource.title,
            destinationSubAccountId: item.destinationSubAccountId,
            allocatedCents: item.amountCents, // Template amount
            isDraft: true,
          },
        });
        generatedMonthlyBudgets.push(monthlyBudget);
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

      const [budgetItem, budgetSource, monthlyBudgetSource] = await Promise.all([
        prisma.budgetItem.findFirst({
          where: { workspaceId: body.workspaceId, id: budgetItemId, isActive: true },
          select: { id: true, title: true, destinationSubAccountId: true },
        }),
        prisma.budgetSource.findFirst({
          where: { workspaceId: body.workspaceId, id: budgetSourceId, isActive: true },
          select: { id: true, title: true },
        }),
        prisma.monthlyBudgetSource.findFirst({
          where: { workspaceId: body.workspaceId, year, month, budgetSourceId },
          select: { id: true },
        }),
      ]);

      if (!budgetItem || !budgetSource) {
        return NextResponse.json({ error: "Selected template item or source is invalid." }, { status: 400 });
      }
      if (!monthlyBudgetSource) {
        return NextResponse.json({ error: "Selected source is not part of this month's source plan." }, { status: 400 });
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

      const [deletedBudgets, deletedSources] = await Promise.all([
        prisma.monthlyBudget.deleteMany({
          where: { workspaceId: body.workspaceId, year, month, isDraft: true },
        }),
        prisma.monthlyBudgetSource.deleteMany({
          where: { workspaceId: body.workspaceId, year, month, isDraft: true },
        }),
      ]);

      return NextResponse.json({ deleted: deletedBudgets.count, deletedSources: deletedSources.count });
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
        const currentRowByKey = new Map(
          currentRows.map((row) => [allocationKey(row.budgetItemId, row.budgetSourceId), row]),
        );
        const monthlyBudgetSources = await db.monthlyBudgetSource.findMany({
          where: { workspaceId: body.workspaceId, year, month },
          select: { id: true, budgetSourceId: true, title: true, amountCents: true, isDraft: true },
          orderBy: { createdAt: "asc" },
        });

        if (monthlyBudgetSources.length === 0) {
          throw new Error("No monthly source plan exists for this month.");
        }

        if (currentRows.some((row) => !row.isDraft) || monthlyBudgetSources.some((source) => !source.isDraft)) {
          throw new Error("This monthly budget has already been approved.");
        }

        const validSourceIds = new Set(monthlyBudgetSources.map((source) => source.budgetSourceId));
        const positiveAllocations = allocations.filter((allocation) => allocation.allocatedCents > 0);
        for (const allocation of positiveAllocations) {
          if (!validSourceIds.has(allocation.budgetSourceId)) {
            throw new Error(`Source "${allocation.budgetSourceTitle || allocation.budgetSourceId}" is not in this month's source plan.`);
          }
        }

        const budgetItems = positiveAllocations.length
          ? await db.budgetItem.findMany({
              where: {
                workspaceId: body.workspaceId,
                id: { in: [...new Set(positiveAllocations.map((allocation) => allocation.budgetItemId))] },
                isActive: true,
              },
              select: { id: true, title: true, destinationSubAccountId: true },
            })
          : [];
        const budgetItemById = new Map(budgetItems.map((item) => [item.id, item]));
        const monthlySourceById = new Map(monthlyBudgetSources.map((source) => [source.budgetSourceId, source]));

        const toConfirm = positiveAllocations.map((allocation) => {
          const budgetItem = budgetItemById.get(allocation.budgetItemId);
          if (!budgetItem) {
            throw new Error(`Budget item "${allocation.budgetItemTitle || allocation.budgetItemId}" is invalid or inactive.`);
          }
          const source = monthlySourceById.get(allocation.budgetSourceId);
          if (!source) {
            throw new Error(`Source "${allocation.budgetSourceTitle || allocation.budgetSourceId}" is not in this month's source plan.`);
          }
          const existingRow = currentRowByKey.get(allocationKey(allocation.budgetItemId, allocation.budgetSourceId));

          return {
            id: existingRow?.id,
            budgetItemId: budgetItem.id,
            budgetSourceId: source.budgetSourceId,
            destinationSubAccountId: budgetItem.destinationSubAccountId,
            allocatedCents: allocation.allocatedCents,
            budgetItemTitle: allocation.budgetItemTitle || budgetItem.title,
            budgetSourceTitle: allocation.budgetSourceTitle || source.title,
          };
        });
        const toDeleteIds = currentRows
          .filter((row) => !positiveAllocations.some((allocation) => allocationKey(allocation.budgetItemId, allocation.budgetSourceId) === allocationKey(row.budgetItemId, row.budgetSourceId)))
          .map((row) => row.id);

        if (toConfirm.length === 0) {
          throw new Error("At least one monthly allocation must remain before approval.");
        }

        // Only check that total allocated equals total sources (no per-item validation)
        const totalAllocatedCents = toConfirm.reduce((sum, row) => sum + row.allocatedCents, 0);
        const totalSourceCents = monthlyBudgetSources.reduce((sum, source) => sum + source.amountCents, 0);
        if (totalAllocatedCents !== totalSourceCents) {
          throw new Error(
            `Total allocated (${totalAllocatedCents}) must equal total sources (${totalSourceCents}).`,
          );
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

        await db.monthlyBudgetSource.updateMany({
          where: { workspaceId: body.workspaceId, year, month, isDraft: true },
          data: { isDraft: false, confirmedAt: applyTimestamp },
        });

        await db.monthlyBudget.deleteMany({
          where: { workspaceId: body.workspaceId, year, month },
        });

        await db.monthlyBudget.createMany({
          data: toConfirm.map((row) => ({
            workspaceId: body.workspaceId,
            budgetItemId: row.budgetItemId,
            budgetSourceId: row.budgetSourceId,
            year,
            month,
            budgetItemTitle: row.budgetItemTitle,
            budgetSourceTitle: row.budgetSourceTitle,
            destinationSubAccountId: row.destinationSubAccountId,
            allocatedCents: row.allocatedCents,
            isDraft: false,
            confirmedAt: applyTimestamp,
            appliedAt:
              applyToSubAccounts && row.destinationSubAccountId && row.allocatedCents > 0 ? applyTimestamp : null,
          })),
        });

        const ledgerRows = toConfirm.filter((row) => applyToSubAccounts && row.destinationSubAccountId && row.allocatedCents > 0);
        if (ledgerRows.length > 0) {
          await db.transaction.createMany({
            data: ledgerRows.map((row) => {
              const destinationBudget = destinationBudgetById.get(row.destinationSubAccountId!);
              if (!destinationBudget) {
                throw new Error(`Destination sub-account is missing for "${row.budgetItemTitle ?? "budget item"}".`);
              }

              return {
                workspaceId: body.workspaceId,
                accountId: destinationBudget.accountId,
                budgetId: destinationBudget.id,
                kind: "ADJUSTMENT",
                direction: "CREDIT",
                date: monthDate(year, month),
                amountCents: row.allocatedCents,
                subject: `Monthly budget allocation: ${row.budgetItemTitle ?? "Budget item"}`,
                details: `Approved budget for ${month}/${year}`,
              };
            }),
          });
        }

        return {
          confirmed: toConfirm.length,
          appliedToSubAccounts: applyToSubAccounts,
          destinationBudgetIds: [...destinationBudgetById.keys()],
        };
      });

      for (const budgetId of result.destinationBudgetIds) {
        await recalculateBudgetAvailableCents(prisma, body.workspaceId, budgetId);
      }

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

    if (type === "monthlySource") {
      const workspaceId = searchParams.get("workspaceId");
      if (!workspaceId) {
        return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
      }

      await requireWorkspaceAccess(workspaceId);

      const monthlySource = await prisma.monthlyBudgetSource.findUnique({
        where: { id },
        select: { workspaceId: true, budgetSourceId: true, year: true, month: true, isDraft: true },
      });
      if (!monthlySource || monthlySource.workspaceId !== workspaceId) {
        return NextResponse.json({ error: "Monthly budget source not found" }, { status: 404 });
      }
      if (!monthlySource.isDraft) {
        return NextResponse.json({ error: "Approved monthly sources cannot be removed." }, { status: 409 });
      }

      await prisma.$transaction([
        prisma.monthlyBudget.deleteMany({
          where: {
            workspaceId,
            year: monthlySource.year,
            month: monthlySource.month,
            budgetSourceId: monthlySource.budgetSourceId,
          },
        }),
        prisma.monthlyBudgetSource.delete({
          where: { id },
        }),
      ]);
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

    if (action === "updateMonthlySource") {
      const parsed = UpdateMonthlyBudgetSourceSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }

      await requireWorkspaceAccess(body.workspaceId);
      const { id, year, month, title, ownerId, amountCents } = parsed.data;
      const alreadyConfirmed = await ensureMonthIsNotConfirmed(body.workspaceId, year, month);
      if (alreadyConfirmed) {
        return alreadyConfirmed;
      }

      const existing = await prisma.monthlyBudgetSource.findUnique({
        where: { id },
        select: { workspaceId: true, year: true, month: true },
      });
      if (!existing || existing.workspaceId !== body.workspaceId || existing.year !== year || existing.month !== month) {
        return NextResponse.json({ error: "Monthly source not found" }, { status: 404 });
      }

      const updated = await prisma.monthlyBudgetSource.update({
        where: { id },
        data: { title, ownerId, amountCents },
        include: {
          owner: {
            select: { id: true, name: true, email: true },
          },
        },
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
