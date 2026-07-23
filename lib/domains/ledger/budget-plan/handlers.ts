import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getIdempotencyKey, PostingConflictError } from "@/lib/domains/ledger";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";
import {
  ConfirmMonthlySchema,
  CreateMonthlyItemSchema,
  CreateMonthlySourceSchema,
  CreateTemplateItemSchema,
  CreateTemplateSourceSchema,
  DeleteSchema,
  DiscardMonthlyDraftSchema,
  PeriodSchema,
  StartBlankSchema,
  StartFromSetupSchema,
  UpdateMonthlyItemSchema,
  UpdateMonthlySourceSchema,
  UpdateTemplateItemSchema,
  UpdateTemplateSourceSchema,
} from "@/lib/domains/ledger/budget-plan/contracts";
import { confirmMonthlyBudget } from "@/lib/domains/ledger/budget-plan/confirm-service";
import {
  discardMonthlyDraft,
  startBlankMonthlyPlan,
  startMonthlyPlanFromSetup,
} from "@/lib/domains/ledger/budget-plan/monthly-draft-service";
import {
  createMonthlyItem,
  createMonthlySource,
  deleteMonthlyItem,
  deleteMonthlySource,
  updateMonthlyItem,
  updateMonthlySource,
} from "@/lib/domains/ledger/budget-plan/monthly-entry-service";
import { getBudgetPlan } from "@/lib/domains/ledger/budget-plan/query-service";
import {
  archiveTemplateItem,
  archiveTemplateSource,
  createTemplateItem,
  createTemplateSource,
  updateTemplateItem,
  updateTemplateSource,
} from "@/lib/domains/ledger/budget-plan/template-service";
import { BudgetPlanRequestError } from "@/lib/domains/ledger/budget-plan/support";

function validationError(error: z.ZodError) {
  return NextResponse.json(
    { error: "Invalid budget plan request", code: "UNPROCESSABLE_ENTITY", details: error.flatten() },
    { status: 422 },
  );
}

function handleError(error: unknown, fallback: string) {
  const limited = rateLimitResponse(error);
  if (limited) return limited;
  if (error instanceof ApiAuthError || error instanceof BudgetPlanRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PostingConflictError) {
    return NextResponse.json({ error: error.message, code: "CONFLICT" }, { status: 409 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "A budget plan already exists for this period.", code: "CONFLICT" },
        { status: 409 },
      );
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Budget plan record not found.", code: "NOT_FOUND" }, { status: 404 });
    }
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback, code: "INTERNAL_ERROR" }, { status: 500 });
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
      const parsed = PeriodSchema.safeParse({ year: Number(yearParam), month: Number(monthParam) });
      if (!parsed.success) return validationError(parsed.error);
      period = parsed.data;
    }
    return NextResponse.json(await getBudgetPlan(workspaceId, period));
  } catch (error) {
    return handleError(error, "Failed to load budget plan");
  }
}

export async function POST(request: Request) {
  try {
    await enforceDistributedRateLimit(request, {
      scope: "budget-plan-post",
      limit: 30,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "createTemplateItem") {
      const parsed = CreateTemplateItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await createTemplateItem(workspaceId, parsed.data), { status: 201 });
    }
    if (action === "createTemplateSource") {
      const parsed = CreateTemplateSourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await createTemplateSource(workspaceId, parsed.data), { status: 201 });
    }
    if (action === "startBlank") {
      const parsed = StartBlankSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await startBlankMonthlyPlan(workspaceId, parsed.data), { status: 201 });
    }
    if (action === "startFromSetup") {
      const parsed = StartFromSetupSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await startMonthlyPlanFromSetup(workspaceId, parsed.data), { status: 201 });
    }
    if (action === "createMonthlyItem") {
      const parsed = CreateMonthlyItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await createMonthlyItem(workspaceId, parsed.data), { status: 201 });
    }
    if (action === "createMonthlySource") {
      const parsed = CreateMonthlySourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await createMonthlySource(workspaceId, parsed.data), { status: 201 });
    }
    if (action === "discardMonthlyDraft") {
      const parsed = DiscardMonthlyDraftSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      await discardMonthlyDraft(workspaceId, parsed.data.planId);
      return NextResponse.json({ success: true });
    }
    if (action === "confirmMonthly") {
      const parsed = ConfirmMonthlySchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { userId, workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await confirmMonthlyBudget({
        workspaceId,
        userId,
        input: parsed.data,
        idempotencyKey: getIdempotencyKey(request, `monthly-budget-confirm:${parsed.data.planId}`),
      }));
    }
    return NextResponse.json({ error: "Invalid action", code: "INVALID_REQUEST" }, { status: 400 });
  } catch (error) {
    return handleError(error, "Failed to process budget plan request");
  }
}

export async function PATCH(request: Request) {
  try {
    await enforceDistributedRateLimit(request, {
      scope: "budget-plan-patch",
      limit: 30,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";
    if (action === "updateTemplateItem") {
      const parsed = UpdateTemplateItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await updateTemplateItem(workspaceId, parsed.data));
    }
    if (action === "updateTemplateSource") {
      const parsed = UpdateTemplateSourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await updateTemplateSource(workspaceId, parsed.data));
    }
    if (action === "updateMonthlyItem") {
      const parsed = UpdateMonthlyItemSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await updateMonthlyItem(workspaceId, parsed.data));
    }
    if (action === "updateMonthlySource") {
      const parsed = UpdateMonthlySourceSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
      return NextResponse.json(await updateMonthlySource(workspaceId, parsed.data));
    }
    return NextResponse.json({ error: "Invalid action", code: "INVALID_REQUEST" }, { status: 400 });
  } catch (error) {
    return handleError(error, "Failed to update budget plan");
  }
}

export async function DELETE(request: Request) {
  try {
    await enforceDistributedRateLimit(request, {
      scope: "budget-plan-delete",
      limit: 30,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const { searchParams } = new URL(request.url);
    const parsed = DeleteSchema.safeParse({
      workspaceId: searchParams.get("workspaceId"),
      id: searchParams.get("id"),
      type: searchParams.get("type"),
    });
    if (!parsed.success) return validationError(parsed.error);
    const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
    if (parsed.data.type === "templateItem") await archiveTemplateItem(workspaceId, parsed.data.id);
    else if (parsed.data.type === "templateSource") await archiveTemplateSource(workspaceId, parsed.data.id);
    else if (parsed.data.type === "monthlyItem") await deleteMonthlyItem(workspaceId, parsed.data.id);
    else await deleteMonthlySource(workspaceId, parsed.data.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error, "Failed to delete budget plan record");
  }
}
