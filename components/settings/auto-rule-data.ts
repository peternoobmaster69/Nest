import type { AutoRule } from "./auto-rule-editor-dialog";

function getRuleFilters(rule: AutoRule) {
  return rule.filters.map((filter) => filter.trim()).filter(Boolean);
}

export function sanitizeAutoRule(rule: AutoRule): AutoRule {
  if (rule.action === "DEDUCT_SAME_WORKSPACE") {
    return {
      id: rule.id, name: rule.name.trim(), enabled: rule.enabled, action: rule.action,
      filters: getRuleFilters(rule), sourceBudgetId: rule.sourceBudgetId, destinationBudgetId: rule.destinationBudgetId,
    };
  }
  return { ...rule, name: rule.name.trim(), filters: getRuleFilters(rule) };
}

function validateRuleTarget(rule: AutoRule, label: string) {
  if (rule.action === "DEDUCT_SAME_WORKSPACE") {
    if (!rule.sourceBudgetId) return `Rule "${label}" needs a source sub account.`;
    if (!rule.destinationBudgetId) return `Rule "${label}" needs a destination sub account.`;
    if (rule.sourceBudgetId === rule.destinationBudgetId) return `Rule "${label}" needs different source and destination sub accounts.`;
    return null;
  }
  if (!rule.sourceWorkspaceId) return `Rule "${label}" needs a source workspace.`;
  if (!rule.sourceAccountId) return `Rule "${label}" needs a source bank account.`;
  if (!rule.sourceBudgetId) return `Rule "${label}" needs a source sub account.`;
  return null;
}

export function getAutoRuleValidationMessage(rules: AutoRule[]) {
  for (const [index, rule] of rules.entries()) {
    const label = rule.name.trim();
    if (!label) return `Rule ${index + 1} needs a name.`;
    if (getRuleFilters(rule).length === 0) return `Rule "${label}" needs at least one subject keyword.`;
    const targetMessage = validateRuleTarget(rule, label);
    if (targetMessage) return targetMessage;
  }
  return null;
}

export function createEmptyAutoRule(destination: { sourceBudgetId?: string; destinationBudgetId?: string } = {}): AutoRule {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rule-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("")}`;
  return {
    id, name: "New rule", enabled: true, action: "DEDUCT_SAME_WORKSPACE", filters: [],
    sourceBudgetId: destination.sourceBudgetId ?? "", destinationBudgetId: destination.destinationBudgetId ?? "",
  };
}
