"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch as fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { bankAccountsQueryOptions, type BankAccount } from "@/lib/accounts";
import { getAutoAccountingNotice } from "@/components/settings/operation-notices";
import { isRecentAuthenticationRequired } from "@/components/reauthentication-message";
import { createEmptyAutoRule, getAutoRuleValidationMessage, sanitizeAutoRule } from "@/components/settings/auto-rule-data";
import type { AutoRule } from "@/components/settings/auto-rule-editor-dialog";

type Budget = { id: string; accountId: string; name: string; isActive: boolean; receivableReservedCents?: number };
type SaveRulesPayload = {
  workspaceId: string;
  rules: AutoRule[];
  previousRules: AutoRule[];
  closeEditor?: boolean;
  message: string;
};

export function useAutoRuleSettings({ workspaceId, defaultReceivableBudgetId, accounts, budgets, workspaces }: {
  workspaceId: string | null;
  defaultReceivableBudgetId: string | null;
  accounts?: BankAccount[];
  budgets?: Budget[];
  workspaces: Array<{ id: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const activeWorkspace = useRef(workspaceId);
  const mutationInFlight = useRef(false);
  const [autoRuleMessage, setAutoRuleMessage] = useState("");
  const [ruleDrafts, setRuleDrafts] = useState<AutoRule[]>([]);
  const [editingAutoRule, setEditingAutoRule] = useState<AutoRule | null>(null);
  const [keywordInput, setKeywordInput] = useState("");

  useLayoutEffect(() => { activeWorkspace.current = workspaceId; }, [workspaceId]);
  useEffect(() => {
    setRuleDrafts([]);
    setEditingAutoRule(null);
    setKeywordInput("");
    setAutoRuleMessage("");
  }, [workspaceId]);

  const autoRules = useQuery({
    queryKey: queryKeys.key(["credit-txn-auto-rules", workspaceId]),
    queryFn: () => fetchJson<{ workspaceId: string; rules: AutoRule[] }>(`/api/credit-transactions/auto-rules?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  useEffect(() => {
    if (autoRules.data) setRuleDrafts(autoRules.data.rules);
  }, [autoRules.data]);

  const sourceWorkspaceIds = useMemo(() => {
    const rules = editingAutoRule ? [...ruleDrafts, editingAutoRule] : ruleDrafts;
    return Array.from(new Set(rules
      .filter((rule): rule is Extract<AutoRule, { action: "RECEIVABLE_OTHER_WORKSPACE" }> => rule.action === "RECEIVABLE_OTHER_WORKSPACE")
      .map((rule) => rule.sourceWorkspaceId).filter(Boolean)));
  }, [ruleDrafts, editingAutoRule]);
  const crossWorkspaceData = useQueries({
    queries: sourceWorkspaceIds.flatMap((targetWorkspaceId) => ([
      bankAccountsQueryOptions(targetWorkspaceId),
      {
        queryKey: queryKeys.key(["rule-budgets", targetWorkspaceId]),
        queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${targetWorkspaceId}`),
        enabled: Boolean(targetWorkspaceId),
      },
    ])),
  });
  const crossWorkspaceAccounts = new Map(sourceWorkspaceIds.map((id, index) => [id, (crossWorkspaceData[index * 2]?.data as BankAccount[] | undefined) ?? []]));
  const crossWorkspaceBudgets = new Map(sourceWorkspaceIds.map((id, index) => [id, (crossWorkspaceData[index * 2 + 1]?.data as Budget[] | undefined) ?? []]));
  const defaultDestination = useMemo(() => {
    const activeBudgets = (budgets ?? []).filter((budget) => budget.isActive);
    const sourceBudgetId = activeBudgets.find((budget) => budget.id !== defaultReceivableBudgetId)?.id ?? activeBudgets[0]?.id ?? "";
    const preferredDestination = defaultReceivableBudgetId && defaultReceivableBudgetId !== sourceBudgetId
      && activeBudgets.some((budget) => budget.id === defaultReceivableBudgetId);
    const destinationBudgetId = preferredDestination ? defaultReceivableBudgetId : activeBudgets.find((budget) => budget.id !== sourceBudgetId)?.id ?? "";
    return { sourceBudgetId, destinationBudgetId };
  }, [budgets, defaultReceivableBudgetId]);

  const clearEditor = () => { setEditingAutoRule(null); setKeywordInput(""); };
  const saveAutoRules = useMutation({
    mutationFn: (payload: SaveRulesPayload) => fetchJson<{ workspaceId: string; rules: AutoRule[] }>("/api/credit-transactions/auto-rules", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: payload.workspaceId, rules: payload.rules }),
    }),
    onSuccess: (data, payload) => {
      if (activeWorkspace.current === payload.workspaceId) {
        setRuleDrafts(data.rules);
        if (payload.closeEditor) clearEditor();
        setAutoRuleMessage(payload.message);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["credit-txn-auto-rules", payload.workspaceId]) });
    },
    onError: (error, payload) => {
      if (activeWorkspace.current !== payload.workspaceId) return;
      setRuleDrafts(payload.previousRules);
      setAutoRuleMessage(error instanceof Error ? error.message : "Failed to save auto-accounting rules.");
    },
    onSettled: () => { mutationInFlight.current = false; },
  });
  const runAutoRules = useMutation({
    mutationFn: (targetWorkspaceId: string) => fetchJson<{ ok: boolean; scanned: number; matched: number; accounted: number; skipped: number }>("/api/credit-transactions/auto-rules/run", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: targetWorkspaceId }),
    }),
    onSuccess: (data, targetWorkspaceId) => {
      if (activeWorkspace.current === targetWorkspaceId) {
        setAutoRuleMessage(`Auto-accounted ${data.accounted} transaction${data.accounted === 1 ? "" : "s"} from ${data.matched} matched rule hits.`);
      }
      for (const root of ["credit-transactions", "transactions", "receivables", "budgets", "bank-accounts", "receivables-summary", "dashboard-summary"] as const) {
        queryClient.invalidateQueries({ queryKey: queryKeys.all(root) });
      }
    },
    onError: (error, targetWorkspaceId) => {
      if (activeWorkspace.current === targetWorkspaceId) setAutoRuleMessage(error instanceof Error ? error.message : "Failed to run auto-accounting.");
    },
    onSettled: () => { mutationInFlight.current = false; },
  });

  const persistRules = (rules: AutoRule[], options: { closeEditor?: boolean; message: string }) => {
    if (!workspaceId || mutationInFlight.current) return false;
    const validationMessage = getAutoRuleValidationMessage(rules);
    if (validationMessage) { setAutoRuleMessage(validationMessage); return false; }
    mutationInFlight.current = true;
    saveAutoRules.mutate({ workspaceId, rules: rules.map(sanitizeAutoRule), previousRules: ruleDrafts, ...options });
    return true;
  };
  const runRules = () => {
    if (!workspaceId || mutationInFlight.current) return;
    mutationInFlight.current = true;
    runAutoRules.mutate(workspaceId);
  };
  const openRuleEditor = (rule: AutoRule) => {
    if (mutationInFlight.current) return;
    setEditingAutoRule({ ...rule, filters: [...rule.filters] });
    setKeywordInput("");
    setAutoRuleMessage("");
  };
  const closeRuleEditor = () => { if (!mutationInFlight.current) clearEditor(); };
  const updateEditingRule = (updater: (rule: AutoRule) => AutoRule) => {
    if (mutationInFlight.current) return;
    setEditingAutoRule((current) => current ? updater(current) : current);
  };
  const saveEditingRule = () => {
    if (!editingAutoRule) return;
    const sanitized = sanitizeAutoRule(editingAutoRule);
    const existing = ruleDrafts.some((rule) => rule.id === sanitized.id);
    const next = existing ? ruleDrafts.map((rule) => rule.id === sanitized.id ? sanitized : rule) : [...ruleDrafts, sanitized];
    persistRules(next, { closeEditor: true, message: `Rule "${sanitized.name}" saved.` });
  };
  const addRuleFilter = () => {
    const keyword = keywordInput.trim();
    if (!keyword || mutationInFlight.current) return;
    updateEditingRule((current) => ({ ...current, filters: [...current.filters, keyword] }));
    setKeywordInput("");
  };
  const removeRuleFilter = (index: number) => updateEditingRule((current) => ({ ...current, filters: current.filters.filter((_, itemIndex) => itemIndex !== index) }));
  const moveRule = (id: string, direction: -1 | 1) => {
    const index = ruleDrafts.findIndex((rule) => rule.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ruleDrafts.length) return;
    const next = [...ruleDrafts];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    if (persistRules(next, { message: "Rule order saved." })) setRuleDrafts(next);
  };
  const removeRule = (id: string) => {
    if (mutationInFlight.current) return;
    if (!ruleDrafts.some((rule) => rule.id === id)) { clearEditor(); return; }
    persistRules(ruleDrafts.filter((rule) => rule.id !== id), { closeEditor: true, message: "Rule deleted." });
  };
  const addRule = () => {
    if (mutationInFlight.current) return;
    openRuleEditor(createEmptyAutoRule(defaultDestination));
    setAutoRuleMessage("New rule added. Add at least one subject keyword before saving.");
  };
  const toggleRuleEnabled = (id: string, enabled: boolean) => {
    const next = ruleDrafts.map((rule) => rule.id === id ? { ...rule, enabled } : rule);
    if (persistRules(next, { message: enabled ? "Rule enabled." : "Rule paused." })) setRuleDrafts(next);
  };
  const resetRules = () => {
    if (mutationInFlight.current) return;
    setRuleDrafts(autoRules.data?.rules ?? []);
    clearEditor();
    setAutoRuleMessage("");
  };

  const getBudgetName = (id: string, sourceWorkspaceId?: string) => {
    const choices = sourceWorkspaceId ? crossWorkspaceBudgets.get(sourceWorkspaceId) : budgets;
    return choices?.find((budget) => budget.id === id)?.name || "Sub account";
  };
  const getRuleActionLabel = (rule: AutoRule) => rule.action === "DEDUCT_SAME_WORKSPACE" ? "Transfer same workspace" : "Create receivable";
  const getRuleTargetLabel = (rule: AutoRule) => {
    if (rule.action === "DEDUCT_SAME_WORKSPACE") return `${getBudgetName(rule.sourceBudgetId)} -> ${getBudgetName(rule.destinationBudgetId)}`;
    const workspace = workspaces.find((item) => item.id === rule.sourceWorkspaceId)?.name || "Workspace";
    const choices = rule.sourceWorkspaceId ? crossWorkspaceAccounts.get(rule.sourceWorkspaceId) : accounts;
    const account = choices?.find((item) => item.id === rule.sourceAccountId)?.name || "Bank account";
    return `${workspace} · ${account} · ${getBudgetName(rule.sourceBudgetId, rule.sourceWorkspaceId)}`;
  };
  const editingRuleIndex = editingAutoRule ? ruleDrafts.findIndex((rule) => rule.id === editingAutoRule.id) : -1;
  const editingDisplayIndex = editingRuleIndex >= 0 ? editingRuleIndex + 1 : ruleDrafts.length + 1;
  const sameWorkspaceBudgets = (budgets ?? []).filter((budget) => budget.isActive);
  const sourceAccounts = editingAutoRule?.action === "RECEIVABLE_OTHER_WORKSPACE"
    ? (crossWorkspaceAccounts.get(editingAutoRule.sourceWorkspaceId) ?? []).filter((account) => account.isActive) : [];
  const sourceBudgets = editingAutoRule?.action === "RECEIVABLE_OTHER_WORKSPACE"
    ? (crossWorkspaceBudgets.get(editingAutoRule.sourceWorkspaceId) ?? []).filter((budget) => budget.isActive && budget.accountId === editingAutoRule.sourceAccountId) : [];
  const getDefaultSourceBudgetId = (sourceWorkspaceId: string, accountId: string) =>
    (crossWorkspaceBudgets.get(sourceWorkspaceId) ?? []).find((budget) => budget.isActive && budget.accountId === accountId)?.id ?? "";
  const hasDraftChanges = JSON.stringify(ruleDrafts) !== JSON.stringify(autoRules.data?.rules ?? []);

  return {
    workspaceId, workspaces, autoRules, ruleDrafts, editingAutoRule, editingRuleIndex, editingDisplayIndex, keywordInput,
    defaultDestination, sameWorkspaceBudgets, sourceAccounts, sourceBudgets,
    isRunning: runAutoRules.isPending,
    isBusy: saveAutoRules.isPending || runAutoRules.isPending,
    canReset: Boolean(autoRuleMessage || editingAutoRule || hasDraftChanges),
    autoRuleNotice: getAutoAccountingNotice(autoRuleMessage), autoRuleRequiresReauthentication: isRecentAuthenticationRequired(autoRuleMessage),
    openRuleEditor, closeRuleEditor, updateEditingRule, saveEditingRule, setKeywordInput, addRuleFilter, removeRuleFilter,
    moveRule, removeRule, addRule, toggleRuleEnabled, resetRules, runRules, getRuleActionLabel, getRuleTargetLabel, getDefaultSourceBudgetId,
  };
}
