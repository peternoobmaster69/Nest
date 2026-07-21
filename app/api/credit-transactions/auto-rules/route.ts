import { parseCreditTxnAutoRules, CreditTxnAutoRulesSchema, stringifyCreditTxnAutoRules } from "@/lib/credit-txn-auto-rules";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateAutoRulesSchema = z.object({
  workspaceId: z.string().min(1),
  rules: CreditTxnAutoRulesSchema,
});

function formatRuleSchemaError(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "rules";
      return `${path}: ${issue.message}`;
    })
    .join(" ");
}

async function validateRuleTargets(workspaceId: string, rules: z.infer<typeof CreditTxnAutoRulesSchema>) {
  for (const rule of rules) {
    if (rule.action === "DEDUCT_SAME_WORKSPACE") {
      if (rule.sourceBudgetId === rule.destinationBudgetId) {
        throw new Error(`Rule "${rule.name}" needs different source and destination sub accounts.`);
      }

      const sameWorkspaceBudgets = await prisma.budgetEnvelope.findMany({
        where: {
          id: { in: [rule.sourceBudgetId, rule.destinationBudgetId] },
          workspaceId,
          isActive: true,
        },
        select: {
          id: true,
          account: {
            select: {
              kind: true,
              isActive: true,
            },
          },
        },
      });

      const sourceBudget = sameWorkspaceBudgets.find((budget) => budget.id === rule.sourceBudgetId);
      const destinationBudget = sameWorkspaceBudgets.find((budget) => budget.id === rule.destinationBudgetId);
      if (!sourceBudget || sourceBudget.account.kind !== "BANK" || !sourceBudget.account.isActive) {
        throw new Error(`Rule "${rule.name}" has an invalid source sub account.`);
      }
      if (!destinationBudget || destinationBudget.account.kind !== "BANK" || !destinationBudget.account.isActive) {
        throw new Error(`Rule "${rule.name}" has an invalid destination sub account.`);
      }
      continue;
    }

    await requireWorkspaceAccess(rule.sourceWorkspaceId);

    const sourceAccount = await prisma.financialAccount.findFirst({
      where: {
        id: rule.sourceAccountId,
        workspaceId: rule.sourceWorkspaceId,
        kind: "BANK",
        isActive: true,
      },
      select: { id: true },
    });
    if (!sourceAccount) {
      throw new Error(`Rule "${rule.name}" has an invalid source bank account.`);
    }

    const sourceBudget = await prisma.budgetEnvelope.findFirst({
      where: {
        id: rule.sourceBudgetId,
        workspaceId: rule.sourceWorkspaceId,
        accountId: sourceAccount.id,
        isActive: true,
      },
      select: { id: true },
    });
    if (!sourceBudget) {
      throw new Error(`Rule "${rule.name}" has an invalid source sub account.`);
    }
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, creditCardAutoRules: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    return NextResponse.json({
      workspaceId,
      rules: parseCreditTxnAutoRules(workspace.creditCardAutoRules),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch auto-accounting rules", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = UpdateAutoRulesSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid auto-accounting rules", message: formatRuleSchemaError(parsed.error) },
        { status: 400 },
      );
    }

    await requireWorkspaceAccess(parsed.data.workspaceId, "OWNER");
    await validateRuleTargets(parsed.data.workspaceId, parsed.data.rules);

    const updated = await prisma.workspace.update({
      where: { id: parsed.data.workspaceId },
      data: {
        creditCardAutoRules: stringifyCreditTxnAutoRules(parsed.data.rules),
      },
      select: { id: true, creditCardAutoRules: true },
    });

    return NextResponse.json({
      workspaceId: updated.id,
      rules: parseCreditTxnAutoRules(updated.creditCardAutoRules),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to save auto-accounting rules", message }, { status: 500 });
  }
}
