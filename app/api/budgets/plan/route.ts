import { applyBudgetAvailableDelta } from "@/lib/budget-ledger";
import { executePosting, getIdempotencyKey, PostingConflictError } from "@/lib/posting-service";
import {
  getUnappliedMonthlyBudgetItemCents,
  summarizeMonthlyBudgetPlan,
} from "@/lib/monthly-budget-plan.mjs";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const ownerSelect = { id: true, name: true, email: true } as const;
const destinationSelect = { id: true, name: true } as const;

const WorkspaceActionSchema = z.object({
  workspaceId: z.string().min(1),
});

const TemplateItemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(0),
  isMonthly: z.boolean().default(true),
  destinationSubAccountId: z.string().min(1).nullable().optional(),
});

const TemplateSourceFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerId: z.string().min(1, "Owner is required"),
  amountCents: z.number().int().min(0),
});

const MonthlyItemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(0),
  destinationSubAccountId: z.string().min(1).nullable().optional(),
});

const MonthlySourceFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerId: z.string().min(1, "Owner is required"),
  amountCents: z.number().int().min(0),
});

const PeriodSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  month: z.number().int().min(1).max(12),
});

const CreateTemplateItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("createTemplateItem"),
}).and(TemplateItemFieldsSchema);

const CreateTemplateSourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("createTemplateSource"),
}).and(TemplateSourceFieldsSchema);

const StartBlankSchema = WorkspaceActionSchema.extend({
  action: z.literal("startBlank"),
}).and(PeriodSchema);

const StartFromSetupSchema = WorkspaceActionSchema.extend({
  action: z.literal("startFromSetup"),
}).and(PeriodSchema);

const CreateMonthlyItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("createMonthlyItem"),
  planId: z.string().min(1),
}).and(MonthlyItemFieldsSchema);

const CreateMonthlySourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("createMonthlySource"),
  planId: z.string().min(1),
}).and(MonthlySourceFieldsSchema);

const DiscardMonthlyDraftSchema = WorkspaceActionSchema.extend({
  action: z.literal("discardMonthlyDraft"),
  planId: z.string().min(1),
});

const ConfirmMonthlySchema = WorkspaceActionSchema.extend({
  action: z.literal("confirmMonthly"),
  planId: z.string().min(1),
  applyToSubAccounts: z.boolean().default(false),
});

const UpdateTemplateItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateTemplateItem"),
  id: z.string().min(1),
}).and(TemplateItemFieldsSchema);

const UpdateTemplateSourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateTemplateSource"),
  id: z.string().min(1),
}).and(TemplateSourceFieldsSchema);

const UpdateMonthlyItemSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateMonthlyItem"),
  id: z.string().min(1),
  planId: z.string().min(1),
}).and(MonthlyItemFieldsSchema);

const UpdateMonthlySourceSchema = WorkspaceActionSchema.extend({
  action: z.literal("updateMonthlySource"),
  id: z.string().min(1),
  planId: z.string().min(1),
}).and(MonthlySourceFieldsSchema);

const DeleteSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
  type: z.enum(["templateItem", "templateSource", "monthlyItem", "monthlySource"]),
});

class BudgetPlanRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function monthlyPlanInclude() {
  return {
    sources: {
      include: { owner: { select: ownerSelect } },
      orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    },
    items: {
      include: { destinationSubAccount: { select: destinationSelect } },
      orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    },
  };
}

function monthDate(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
}

function validationError(error: z.ZodError) {
  return NextResponse.json(
    { error: "Invalid budget plan request", details: error.flatten() },
    { status: 400 },
  );
}

function handleError(error: unknown, fallback: string) {
  if (error instanceof ApiAuthError || error instanceof BudgetPlanRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PostingConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A budget plan already exists for this period." }, { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Budget plan record not found." }, { status: 404 });
    }
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: fallback, message }, { status: 500 });
}

async function requireWorkspaceMember(
  db: Pick<Prisma.TransactionClient, "workspaceMember">,
  workspaceId: string,
  userId: string,
) {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { userId: true },
  });

  if (!member) {
    throw new BudgetPlanRequestError(400, "The selected owner is not a member of this workspace.");
  }
}

async function requireWorkspaceDestination(
  db: Pick<Prisma.TransactionClient, "budgetEnvelope">,
  workspaceId: string,
  destinationSubAccountId?: string | null,
) {
  if (!destinationSubAccountId) return null;

  const destination = await db.budgetEnvelope.findFirst({
    where: { id: destinationSubAccountId, workspaceId },
    select: { id: true, accountId: true, name: true },
  });

  if (!destination) {
    throw new BudgetPlanRequestError(400, "The selected destination sub-account is not in this workspace.");
  }

  return destination;
}

async function requireDraftPlan(
  db: Pick<Prisma.TransactionClient, "monthlyBudgetPlan">,
  workspaceId: string,
  planId: string,
) {
  const plan = await db.monthlyBudgetPlan.findFirst({
    where: { id: planId, workspaceId },
    select: { id: true, status: true, year: true, month: true },
  });

  if (!plan) {
    throw new BudgetPlanRequestError(404, "Monthly budget plan not found.");
  }
  if (plan.status !== "DRAFT") {
    throw new BudgetPlanRequestError(409, "Only draft monthly budget plans can be changed.");
  }

  return plan;
}

async function nextMonthlyItemSortOrder(db: Prisma.TransactionClient, planId: string) {
  const result = await db.monthlyBudgetPlanItem.aggregate({
    where: { planId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? -1) + 1;
}

async function nextMonthlySourceSortOrder(db: Prisma.TransactionClient, planId: string) {
  const result = await db.monthlyBudgetPlanSource.aggregate({
    where: { planId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? -1) + 1;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { workspaceId } = await requireWorkspaceAccess(searchParams.get("workspaceId"));
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");

    if ((yearParam && !monthParam) || (!yearParam && monthParam)) {
      throw new BudgetPlanRequestError(400, "Both year and month are required to load a monthly plan.");
    }

    let period: z.infer<typeof PeriodSchema> | null = null;
    if (yearParam && monthParam) {
      const parsed = PeriodSchema.safeParse({
        year: Number(yearParam),
        month: Number(monthParam),
      });
      if (!parsed.success) return validationError(parsed.error);
      period = parsed.data;
    }

    const [items, sources, monthlyPlan, members, subAccounts] = await Promise.all([
      prisma.budgetItem.findMany({
        where: { workspaceId, isActive: true },
        include: { destinationSubAccount: { select: destinationSelect } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.budgetSource.findMany({
        where: { workspaceId, isActive: true },
        include: { owner: { select: ownerSelect } },
        orderBy: { createdAt: "asc" },
      }),
      period
        ? prisma.monthlyBudgetPlan.findFirst({
            where: { workspaceId, year: period.year, month: period.month },
            include: monthlyPlanInclude(),
          })
        : Promise.resolve(null),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: { select: ownerSelect } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.budgetEnvelope.findMany({
        where: { workspaceId, isActive: true },
        select: destinationSelect,
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      setup: { items, sources },
      monthlyPlan,
      members,
      subAccounts,
    });
  } catch (error) {
    return handleError(error, "Failed to load budget plan");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "createTemplateItem") {
      const parsed = CreateTemplateItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      await requireWorkspaceDestination(prisma, workspaceId, parsed.data.destinationSubAccountId);

      const item = await prisma.budgetItem.create({
        data: {
          workspaceId,
          title: parsed.data.title,
          amountCents: parsed.data.amountCents,
          isMonthly: parsed.data.isMonthly,
          destinationSubAccountId: parsed.data.destinationSubAccountId ?? null,
        },
        include: { destinationSubAccount: { select: destinationSelect } },
      });

      return NextResponse.json(item, { status: 201 });
    }

    if (action === "createTemplateSource") {
      const parsed = CreateTemplateSourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      await requireWorkspaceMember(prisma, workspaceId, parsed.data.ownerId);

      const source = await prisma.budgetSource.create({
        data: {
          workspaceId,
          title: parsed.data.title,
          ownerId: parsed.data.ownerId,
          amountCents: parsed.data.amountCents,
        },
        include: { owner: { select: ownerSelect } },
      });

      return NextResponse.json(source, { status: 201 });
    }

    if (action === "startBlank") {
      const parsed = StartBlankSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const plan = await prisma.$transaction(
        async (db) => {
          const existing = await db.monthlyBudgetPlan.findFirst({
            where: { workspaceId, year: parsed.data.year, month: parsed.data.month },
            include: monthlyPlanInclude(),
          });
          if (existing) {
            if (existing.status !== "DRAFT") {
              throw new BudgetPlanRequestError(409, "This monthly budget plan is read-only.");
            }
            return existing;
          }

          return db.monthlyBudgetPlan.create({
            data: { workspaceId, year: parsed.data.year, month: parsed.data.month },
            include: monthlyPlanInclude(),
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return NextResponse.json(plan, { status: 201 });
    }

    if (action === "startFromSetup") {
      const parsed = StartFromSetupSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const plan = await prisma.$transaction(
        async (db) => {
          const existing = await db.monthlyBudgetPlan.findFirst({
            where: { workspaceId, year: parsed.data.year, month: parsed.data.month },
            include: monthlyPlanInclude(),
          });
          if (existing && existing.status !== "DRAFT") {
            throw new BudgetPlanRequestError(409, "This monthly budget plan is read-only.");
          }
          if (existing && (existing.items.length > 0 || existing.sources.length > 0)) {
            throw new BudgetPlanRequestError(409, "Budget Setup can only be applied to an empty monthly draft.");
          }

          const [templateItems, templateSources, members] = await Promise.all([
            db.budgetItem.findMany({
              where: { workspaceId, isActive: true, isMonthly: true },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            }),
            db.budgetSource.findMany({
              where: { workspaceId, isActive: true },
              orderBy: { createdAt: "asc" },
            }),
            db.workspaceMember.findMany({
              where: { workspaceId },
              select: { userId: true },
            }),
          ]);

          const memberIds = new Set(members.map((member) => member.userId));
          const invalidSource = templateSources.find((source) => !memberIds.has(source.ownerId));
          if (invalidSource) {
            throw new BudgetPlanRequestError(
              400,
              `Template source "${invalidSource.title}" has an owner outside this workspace.`,
            );
          }

          const destinationIds = [
            ...new Set(
              templateItems
                .map((item) => item.destinationSubAccountId)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          if (destinationIds.length > 0) {
            const validDestinations = await db.budgetEnvelope.findMany({
              where: { workspaceId, id: { in: destinationIds } },
              select: { id: true },
            });
            if (validDestinations.length !== destinationIds.length) {
              throw new BudgetPlanRequestError(
                400,
                "Budget Setup contains a destination sub-account outside this workspace.",
              );
            }
          }

          const draft =
            existing ??
            (await db.monthlyBudgetPlan.create({
              data: { workspaceId, year: parsed.data.year, month: parsed.data.month },
            }));

          if (templateSources.length > 0) {
            await db.monthlyBudgetPlanSource.createMany({
              data: templateSources.map((source, index) => ({
                planId: draft.id,
                templateSourceId: source.id,
                title: source.title,
                ownerId: source.ownerId,
                amountCents: source.amountCents,
                sortOrder: index,
              })),
            });
          }

          if (templateItems.length > 0) {
            await db.monthlyBudgetPlanItem.createMany({
              data: templateItems.map((item, index) => ({
                planId: draft.id,
                templateItemId: item.id,
                title: item.title,
                amountCents: item.amountCents,
                destinationSubAccountId: item.destinationSubAccountId,
                sortOrder: index,
              })),
            });
          }

          return db.monthlyBudgetPlan.findUniqueOrThrow({
            where: { id: draft.id },
            include: monthlyPlanInclude(),
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return NextResponse.json(plan, { status: 201 });
    }

    if (action === "createMonthlyItem") {
      const parsed = CreateMonthlyItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const item = await prisma.$transaction(
        async (db) => {
          await requireDraftPlan(db, workspaceId, parsed.data.planId);
          await requireWorkspaceDestination(db, workspaceId, parsed.data.destinationSubAccountId);
          const sortOrder = await nextMonthlyItemSortOrder(db, parsed.data.planId);

          return db.monthlyBudgetPlanItem.create({
            data: {
              planId: parsed.data.planId,
              title: parsed.data.title,
              amountCents: parsed.data.amountCents,
              destinationSubAccountId: parsed.data.destinationSubAccountId ?? null,
              sortOrder,
            },
            include: { destinationSubAccount: { select: destinationSelect } },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return NextResponse.json(item, { status: 201 });
    }

    if (action === "createMonthlySource") {
      const parsed = CreateMonthlySourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const source = await prisma.$transaction(
        async (db) => {
          await requireDraftPlan(db, workspaceId, parsed.data.planId);
          await requireWorkspaceMember(db, workspaceId, parsed.data.ownerId);
          const sortOrder = await nextMonthlySourceSortOrder(db, parsed.data.planId);

          return db.monthlyBudgetPlanSource.create({
            data: {
              planId: parsed.data.planId,
              title: parsed.data.title,
              ownerId: parsed.data.ownerId,
              amountCents: parsed.data.amountCents,
              sortOrder,
            },
            include: { owner: { select: ownerSelect } },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return NextResponse.json(source, { status: 201 });
    }

    if (action === "discardMonthlyDraft") {
      const parsed = DiscardMonthlyDraftSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      await prisma.$transaction(
        async (db) => {
          await requireDraftPlan(db, workspaceId, parsed.data.planId);
          await db.monthlyBudgetPlanItem.deleteMany({ where: { planId: parsed.data.planId } });
          await db.monthlyBudgetPlanSource.deleteMany({ where: { planId: parsed.data.planId } });
          await db.monthlyBudgetPlan.delete({ where: { id: parsed.data.planId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return NextResponse.json({ success: true });
    }

    if (action === "confirmMonthly") {
      const parsed = ConfirmMonthlySchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { userId, workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const posting = await executePosting({
        workspaceId,
        operation: "MONTHLY_BUDGET_CONFIRM",
        idempotencyKey: getIdempotencyKey(request, `monthly-budget-confirm:${parsed.data.planId}`),
        actorUserId: userId,
        sourceType: "MONTHLY_BUDGET_PLAN",
        sourceId: parsed.data.planId,
        request: parsed.data,
      }, async (db, postingGroupId) => {
          const claimed = await db.monthlyBudgetPlan.updateMany({
            where: { id: parsed.data.planId, workspaceId, status: "DRAFT" },
            data: { status: "CONFIRMING" },
          });
          if (claimed.count === 0) {
            const current = await db.monthlyBudgetPlan.findFirst({
              where: { id: parsed.data.planId, workspaceId },
              include: monthlyPlanInclude(),
            });
            if (!current) {
              throw new BudgetPlanRequestError(404, "Monthly budget plan not found.");
            }
            if (current?.status === "CONFIRMED") {
              return {
                monthlyPlan: current,
                appliedCents: 0,
                appliedToSubAccounts: current.items.some((item) => item.appliedCents > 0),
              };
            }
            throw new BudgetPlanRequestError(409, "This monthly budget plan is read-only.");
          }

          const plan = await db.monthlyBudgetPlan.findFirstOrThrow({
            where: { id: parsed.data.planId, workspaceId, status: "CONFIRMING" },
            include: monthlyPlanInclude(),
          });
          if (plan.sources.length === 0 || plan.items.length === 0) {
            throw new BudgetPlanRequestError(
              400,
              "A monthly budget needs at least one source and one budget item before confirmation.",
            );
          }

          const planSummary = summarizeMonthlyBudgetPlan(plan.sources, plan.items);
          if (!planSummary.isBalanced) {
            throw new BudgetPlanRequestError(
              400,
              `Budget source total (${planSummary.sourceTotalCents}) must equal budget item total (${planSummary.itemTotalCents}).`,
            );
          }

          const ownerIds = [...new Set(plan.sources.map((source) => source.ownerId))];
          const destinationIds = [
            ...new Set(
              plan.items
                .map((item) => item.destinationSubAccountId)
                .filter((id): id is string => Boolean(id)),
            ),
          ];
          const [validOwners, destinations] = await Promise.all([
            db.workspaceMember.findMany({
              where: { workspaceId, userId: { in: ownerIds } },
              select: { userId: true },
            }),
            destinationIds.length
              ? db.budgetEnvelope.findMany({
                  where: {
                    workspaceId,
                    id: { in: destinationIds },
                    ...(parsed.data.applyToSubAccounts ? { isActive: true } : {}),
                  },
                  select: { id: true, accountId: true },
                })
              : Promise.resolve([]),
          ]);
          if (validOwners.length !== ownerIds.length) {
            throw new BudgetPlanRequestError(
              400,
              "A monthly budget source has an owner outside this workspace.",
            );
          }
          if (destinations.length !== destinationIds.length) {
            throw new BudgetPlanRequestError(
              400,
              parsed.data.applyToSubAccounts
                ? "A monthly budget item has an inactive or invalid destination sub-account."
                : "A monthly budget item has a destination outside this workspace.",
            );
          }
          const destinationById = new Map(destinations.map((destination) => [destination.id, destination]));

          let appliedCents = 0;
          if (parsed.data.applyToSubAccounts) {
            const deltaByDestination = new Map<string, number>();
            const transactionRows: Prisma.TransactionCreateManyInput[] = [];
            for (const item of plan.items) {
              const deltaCents = getUnappliedMonthlyBudgetItemCents(item.amountCents, item.appliedCents);
              if (!item.destinationSubAccountId || deltaCents <= 0) continue;
              const destination = destinationById.get(item.destinationSubAccountId);
              if (!destination) {
                throw new BudgetPlanRequestError(
                  400,
                  `Destination sub-account is missing for "${item.title}".`,
                );
              }

              transactionRows.push({
                workspaceId,
                accountId: destination.accountId,
                budgetId: destination.id,
                kind: "ADJUSTMENT",
                direction: "CREDIT",
                date: monthDate(plan.year, plan.month),
                amountCents: deltaCents,
                subject: `Monthly budget item: ${item.title}`,
                details: `Confirmed budget for ${plan.month}/${plan.year}`,
                externalRef: `monthly-budget-plan:${plan.id}:${item.id}`,
              });
              deltaByDestination.set(
                destination.id,
                (deltaByDestination.get(destination.id) ?? 0) + deltaCents,
              );
              appliedCents += deltaCents;

              await db.monthlyBudgetPlanItem.update({
                where: { id: item.id },
                data: { appliedCents: item.amountCents },
              });
            }

            if (transactionRows.length > 0) {
              const ledgerRows = transactionRows.map((row) => ({ ...row, postingGroupId })) as Prisma.TransactionCreateManyInput[];
              await db.transaction.createMany({ data: ledgerRows });
              for (const [destinationId, deltaCents] of deltaByDestination) {
                await applyBudgetAvailableDelta(db, destinationId, deltaCents);
              }
            }
          }

          await db.monthlyBudgetPlan.update({
            where: { id: plan.id },
            data: { status: "CONFIRMED", confirmedAt: new Date() },
          });
          const confirmedPlan = await db.monthlyBudgetPlan.findUniqueOrThrow({
            where: { id: plan.id },
            include: monthlyPlanInclude(),
          });
          return {
            monthlyPlan: confirmedPlan,
            appliedCents,
            appliedToSubAccounts: parsed.data.applyToSubAccounts,
          };
      });

      return NextResponse.json({
        ...posting.result,
        postingGroupId: posting.postingGroupId,
        replayed: posting.replayed,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleError(error, "Failed to process budget plan request");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "updateTemplateItem") {
      const parsed = UpdateTemplateItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const existing = await prisma.budgetItem.findFirst({
        where: { id: parsed.data.id, workspaceId, isActive: true },
        select: { id: true },
      });
      if (!existing) throw new BudgetPlanRequestError(404, "Template budget item not found.");
      await requireWorkspaceDestination(prisma, workspaceId, parsed.data.destinationSubAccountId);

      const item = await prisma.budgetItem.update({
        where: { id: existing.id },
        data: {
          title: parsed.data.title,
          amountCents: parsed.data.amountCents,
          isMonthly: parsed.data.isMonthly,
          destinationSubAccountId: parsed.data.destinationSubAccountId ?? null,
        },
        include: { destinationSubAccount: { select: destinationSelect } },
      });
      return NextResponse.json(item);
    }

    if (action === "updateTemplateSource") {
      const parsed = UpdateTemplateSourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const existing = await prisma.budgetSource.findFirst({
        where: { id: parsed.data.id, workspaceId, isActive: true },
        select: { id: true },
      });
      if (!existing) throw new BudgetPlanRequestError(404, "Template budget source not found.");
      await requireWorkspaceMember(prisma, workspaceId, parsed.data.ownerId);

      const source = await prisma.budgetSource.update({
        where: { id: existing.id },
        data: {
          title: parsed.data.title,
          ownerId: parsed.data.ownerId,
          amountCents: parsed.data.amountCents,
        },
        include: { owner: { select: ownerSelect } },
      });
      return NextResponse.json(source);
    }

    if (action === "updateMonthlyItem") {
      const parsed = UpdateMonthlyItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const item = await prisma.$transaction(
        async (db) => {
          await requireDraftPlan(db, workspaceId, parsed.data.planId);
          await requireWorkspaceDestination(db, workspaceId, parsed.data.destinationSubAccountId);
          const existing = await db.monthlyBudgetPlanItem.findFirst({
            where: { id: parsed.data.id, planId: parsed.data.planId },
            select: { id: true },
          });
          if (!existing) throw new BudgetPlanRequestError(404, "Monthly budget item not found.");

          return db.monthlyBudgetPlanItem.update({
            where: { id: existing.id },
            data: {
              title: parsed.data.title,
              amountCents: parsed.data.amountCents,
              destinationSubAccountId: parsed.data.destinationSubAccountId ?? null,
            },
            include: { destinationSubAccount: { select: destinationSelect } },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return NextResponse.json(item);
    }

    if (action === "updateMonthlySource") {
      const parsed = UpdateMonthlySourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);
      const source = await prisma.$transaction(
        async (db) => {
          await requireDraftPlan(db, workspaceId, parsed.data.planId);
          await requireWorkspaceMember(db, workspaceId, parsed.data.ownerId);
          const existing = await db.monthlyBudgetPlanSource.findFirst({
            where: { id: parsed.data.id, planId: parsed.data.planId },
            select: { id: true },
          });
          if (!existing) throw new BudgetPlanRequestError(404, "Monthly budget source not found.");

          return db.monthlyBudgetPlanSource.update({
            where: { id: existing.id },
            data: {
              title: parsed.data.title,
              ownerId: parsed.data.ownerId,
              amountCents: parsed.data.amountCents,
            },
            include: { owner: { select: ownerSelect } },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return NextResponse.json(source);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleError(error, "Failed to update budget plan");
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = DeleteSchema.safeParse({
      workspaceId: searchParams.get("workspaceId"),
      id: searchParams.get("id"),
      type: searchParams.get("type"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId);

    if (parsed.data.type === "templateItem") {
      const existing = await prisma.budgetItem.findFirst({
        where: { id: parsed.data.id, workspaceId, isActive: true },
        select: { id: true },
      });
      if (!existing) throw new BudgetPlanRequestError(404, "Template budget item not found.");
      await prisma.budgetItem.update({ where: { id: existing.id }, data: { isActive: false } });
      return NextResponse.json({ success: true });
    }

    if (parsed.data.type === "templateSource") {
      const existing = await prisma.budgetSource.findFirst({
        where: { id: parsed.data.id, workspaceId, isActive: true },
        select: { id: true },
      });
      if (!existing) throw new BudgetPlanRequestError(404, "Template budget source not found.");
      await prisma.budgetSource.update({ where: { id: existing.id }, data: { isActive: false } });
      return NextResponse.json({ success: true });
    }

    if (parsed.data.type === "monthlyItem") {
      await prisma.$transaction(
        async (db) => {
          const item = await db.monthlyBudgetPlanItem.findFirst({
            where: { id: parsed.data.id, plan: { workspaceId } },
            select: { id: true, planId: true },
          });
          if (!item) throw new BudgetPlanRequestError(404, "Monthly budget item not found.");
          await requireDraftPlan(db, workspaceId, item.planId);
          await db.monthlyBudgetPlanItem.delete({ where: { id: item.id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return NextResponse.json({ success: true });
    }

    await prisma.$transaction(
      async (db) => {
        const source = await db.monthlyBudgetPlanSource.findFirst({
          where: { id: parsed.data.id, plan: { workspaceId } },
          select: { id: true, planId: true },
        });
        if (!source) throw new BudgetPlanRequestError(404, "Monthly budget source not found.");
        await requireDraftPlan(db, workspaceId, source.planId);
        await db.monthlyBudgetPlanSource.delete({ where: { id: source.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error, "Failed to delete budget plan record");
  }
}
