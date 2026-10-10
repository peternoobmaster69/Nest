import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
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
    { error: "Invalid budget plan request", code: "UNPROCESSABLE_ENTITY", details: z.flattenError(error) },
    { status: 422 },
  );
}

function budgetPlanErrorResponse(error: unknown) {
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
  return null;
}

function budgetPlanRoute(request: Request, mutation: boolean, errorMessage: string, handler: () => Promise<Response>) {
  return runSecureApiRoute(request, { mutation, errorMessage }, async () => {
    try {
      return await handler();
    } catch (error) {
      const response = budgetPlanErrorResponse(error);
      if (response) return response;
      throw error;
    }
  });
}

export async function GET(request: Request) {
  return budgetPlanRoute(request, false, "Failed to load budget plan", async () => {
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
  });
}

type ActionHandler = (request: Request, body: unknown) => Promise<Response>;
type WorkspaceAuth = Awaited<ReturnType<typeof requireWorkspaceAccess>>;

function workspaceAction<T extends { workspaceId: string }>(
  schema: z.ZodType<T>,
  execute: (workspaceId: string, input: T, auth: WorkspaceAuth, request: Request) => Promise<unknown>,
  status = 200,
): ActionHandler {
  return async (request, body) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const auth = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
    return NextResponse.json(await execute(auth.workspaceId, parsed.data, auth, request), { status });
  };
}

const postActions = new Map<string, ActionHandler>([
  ["createTemplateItem", workspaceAction(CreateTemplateItemSchema, createTemplateItem, 201)],
  ["createTemplateSource", workspaceAction(CreateTemplateSourceSchema, createTemplateSource, 201)],
  ["startBlank", workspaceAction(StartBlankSchema, startBlankMonthlyPlan, 201)],
  ["startFromSetup", workspaceAction(StartFromSetupSchema, startMonthlyPlanFromSetup, 201)],
  ["createMonthlyItem", workspaceAction(CreateMonthlyItemSchema, createMonthlyItem, 201)],
  ["createMonthlySource", workspaceAction(CreateMonthlySourceSchema, createMonthlySource, 201)],
  ["discardMonthlyDraft", workspaceAction(DiscardMonthlyDraftSchema, async (workspaceId, input) => {
    await discardMonthlyDraft(workspaceId, input.planId);
    return { success: true };
  })],
  ["confirmMonthly", workspaceAction(ConfirmMonthlySchema, (workspaceId, input, auth, request) => confirmMonthlyBudget({
    workspaceId,
    userId: auth.userId,
    input,
    idempotencyKey: getIdempotencyKey(request, `monthly-budget-confirm:${input.planId}`),
  }))],
]);

const patchActions = new Map<string, ActionHandler>([
  ["updateTemplateItem", workspaceAction(UpdateTemplateItemSchema, updateTemplateItem)],
  ["updateTemplateSource", workspaceAction(UpdateTemplateSourceSchema, updateTemplateSource)],
  ["updateMonthlyItem", workspaceAction(UpdateMonthlyItemSchema, updateMonthlyItem)],
  ["updateMonthlySource", workspaceAction(UpdateMonthlySourceSchema, updateMonthlySource)],
]);

const ActionNameSchema = z.object({ action: z.string() });

function mutateBudgetPlan(request: Request, actions: Map<string, ActionHandler>, scope: string, errorMessage: string) {
  return budgetPlanRoute(request, true, errorMessage, async () => {
    await enforceDistributedRateLimit(request, {
      scope,
      limit: 30,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const body = await parseJsonBody(request, z.unknown());
    const action = ActionNameSchema.safeParse(body);
    const handler = action.success ? actions.get(action.data.action) : undefined;
    if (handler) return handler(request, body);
    return NextResponse.json({ error: "Invalid action", code: "INVALID_REQUEST" }, { status: 400 });
  });
}

export async function POST(request: Request) {
  return mutateBudgetPlan(request, postActions, "budget-plan-post", "Failed to process budget plan request");
}

export async function PATCH(request: Request) {
  return mutateBudgetPlan(request, patchActions, "budget-plan-patch", "Failed to update budget plan");
}

const deleteActions = {
  templateItem: archiveTemplateItem,
  templateSource: archiveTemplateSource,
  monthlyItem: deleteMonthlyItem,
  monthlySource: deleteMonthlySource,
};

export async function DELETE(request: Request) {
  return budgetPlanRoute(request, true, "Failed to delete budget plan record", async () => {
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
    await deleteActions[parsed.data.type](workspaceId, parsed.data.id);
    return NextResponse.json({ success: true });
  });
}
