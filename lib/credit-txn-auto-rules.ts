import { z } from "zod";


const SubjectFilterSchema = z.string().trim().min(1).max(120);

const SameWorkspaceDeductRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  action: z.literal("DEDUCT_SAME_WORKSPACE"),
  filters: z.array(SubjectFilterSchema).min(1).max(20),
  sourceBudgetId: z.string().min(1),
  destinationAccountId: z.string().min(1).optional(),
  destinationBudgetId: z.string().min(1),
});

const CrossWorkspaceReceivableRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  action: z.literal("RECEIVABLE_OTHER_WORKSPACE"),
  filters: z.array(SubjectFilterSchema).min(1).max(20),
  sourceWorkspaceId: z.string().min(1),
  sourceAccountId: z.string().min(1),
  sourceBudgetId: z.string().min(1),
});

const CreditTxnAutoRuleSchema = z.discriminatedUnion("action", [
  SameWorkspaceDeductRuleSchema,
  CrossWorkspaceReceivableRuleSchema,
]);

export const CreditTxnAutoRulesSchema = z.array(CreditTxnAutoRuleSchema).max(100);

export type CreditTxnAutoRule = z.infer<typeof CreditTxnAutoRuleSchema>;

function normalizeCreditTxnAutoRulesInput(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((rule) => {
    if (!rule || typeof rule !== "object" || (rule as { action?: unknown }).action !== "DEDUCT_SAME_WORKSPACE") {
      return rule;
    }

    const sameWorkspaceRule = rule as { sourceBudgetId?: unknown; destinationBudgetId?: unknown };
    if (typeof sameWorkspaceRule.sourceBudgetId === "string") {
      return rule;
    }

    return {
      ...sameWorkspaceRule,
      sourceBudgetId: typeof sameWorkspaceRule.destinationBudgetId === "string" ? sameWorkspaceRule.destinationBudgetId : "",
    };
  });
}

export function parseCreditTxnAutoRules(value: string | null | undefined): CreditTxnAutoRule[] {
  if (!value) return [];
  try {
    const parsed = normalizeCreditTxnAutoRulesInput(JSON.parse(value));
    const result = CreditTxnAutoRulesSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function stringifyCreditTxnAutoRules(rules: CreditTxnAutoRule[]) {
  return JSON.stringify(rules);
}

function normalizeSubjectFilter(value: string) {
  return value.trim().toLowerCase();
}

export function matchesCreditTxnRule(subject: string, rule: CreditTxnAutoRule) {
  const normalizedSubject = subject.trim().toLowerCase();
  if (!normalizedSubject || !rule.enabled) return false;
  return rule.filters.some((filter) => normalizedSubject.includes(normalizeSubjectFilter(filter)));
}

export function findFirstMatchingCreditTxnRule(subject: string, rules: CreditTxnAutoRule[]) {
  return rules.find((rule) => matchesCreditTxnRule(subject, rule)) ?? null;
}
