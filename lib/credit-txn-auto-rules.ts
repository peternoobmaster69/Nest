import { z } from "zod";

export const CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS = 5 * 60 * 1000;

const SubjectFilterSchema = z.string().trim().min(1).max(120);

const SameWorkspaceDeductRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  action: z.literal("DEDUCT_SAME_WORKSPACE"),
  filters: z.array(SubjectFilterSchema).min(1).max(20),
  destinationAccountId: z.string().min(1),
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

export const CreditTxnAutoRuleSchema = z.discriminatedUnion("action", [
  SameWorkspaceDeductRuleSchema,
  CrossWorkspaceReceivableRuleSchema,
]);

export const CreditTxnAutoRulesSchema = z.array(CreditTxnAutoRuleSchema).max(100);

export type CreditTxnAutoRule = z.infer<typeof CreditTxnAutoRuleSchema>;

export function parseCreditTxnAutoRules(value: string | null | undefined): CreditTxnAutoRule[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const result = CreditTxnAutoRulesSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function stringifyCreditTxnAutoRules(rules: CreditTxnAutoRule[]) {
  return JSON.stringify(rules);
}

export function normalizeSubjectFilter(value: string) {
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
