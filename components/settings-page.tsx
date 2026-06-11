"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS } from "@/lib/credit-txn-auto-rules";
import { GMAIL_SYNC_INTERVAL_MS } from "@/lib/gmail-alert-query";
import { formatMoney, normalizeCurrency, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { SINGAPORE_BANKS, getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowRight, ChevronDown, ChevronUp, Copy, Pencil, Play, Plus, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { DataImportSection } from "@/components/data-import-section";
import { EmptyState } from "@/components/ui-skeleton";
import { SettingsAutoRulesSkeleton, SettingsBankAccountsSkeleton } from "@/components/skeletons/SettingsSkeleton";
import { closeOnBackdropDoubleClick } from "@/lib/modal-dismiss";

type Context = {
  workspaceId: string | null;
  defaultAccountId: string | null;
  defaultBudgetId: string | null;
  baseCurrency?: string | null;
  publicNetWorthEnabled?: boolean | null;
  publicNetWorthToken?: string | null;
  workspaces?: Array<{ id: string; name: string }>;
};

type GmailStatus = {
  connected: boolean;
  integration: {
    id: string;
    email: string;
    scope: string | null;
    lastSyncedAt: string | null;
    createdAt: string;
  } | null;
};

type BankAccount = {
  id: string;
  name: string;
  bankName: string | null;
  startingCents: number;
  description: string | null;
  isActive: boolean;
  currentBalanceCents: number;
  linkedBudgetTotalCents: number;
  discrepancyCents: number;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
  receivableReservedCents?: number;
};

type AutoRule =
  | {
      id: string;
      name: string;
      enabled: boolean;
      action: "DEDUCT_SAME_WORKSPACE";
      filters: string[];
      sourceBudgetId: string;
      destinationAccountId?: string;
      destinationBudgetId: string;
    }
  | {
      id: string;
      name: string;
      enabled: boolean;
      action: "RECEIVABLE_OTHER_WORKSPACE";
      filters: string[];
      sourceWorkspaceId: string;
      sourceAccountId: string;
      sourceBudgetId: string;
    };

type GmailSyncProgress = {
  phase: "idle" | "reading" | "writing" | "complete" | "error";
  progress: number;
  message: string;
  total: number;
  current: number;
  updatedAt: number;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      const payloadDetail = payload?.message || payload?.error;
      detail = typeof payloadDetail === "string" ? payloadDetail : JSON.stringify(payloadDetail || payload) || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

function getRuleFilters(rule: AutoRule) {
  return rule.filters.map((filter) => filter.trim()).filter(Boolean);
}

function sanitizeAutoRule(rule: AutoRule): AutoRule {
  if (rule.action === "DEDUCT_SAME_WORKSPACE") {
    return {
      id: rule.id,
      name: rule.name.trim(),
      enabled: rule.enabled,
      action: rule.action,
      filters: getRuleFilters(rule),
      sourceBudgetId: rule.sourceBudgetId,
      destinationBudgetId: rule.destinationBudgetId,
    };
  }
  return {
    ...rule,
    name: rule.name.trim(),
    filters: getRuleFilters(rule),
  };
}

function getAutoRuleValidationMessage(rules: AutoRule[]) {
  for (const [index, rule] of rules.entries()) {
    const label = rule.name.trim() || `Rule ${index + 1}`;
    if (!rule.name.trim()) return `Rule ${index + 1} needs a name.`;
    if (getRuleFilters(rule).length === 0) return `Rule "${label}" needs at least one subject keyword.`;

    if (rule.action === "DEDUCT_SAME_WORKSPACE") {
      if (!rule.sourceBudgetId) return `Rule "${label}" needs a source sub account.`;
      if (!rule.destinationBudgetId) return `Rule "${label}" needs a destination sub account.`;
      if (rule.sourceBudgetId === rule.destinationBudgetId) return `Rule "${label}" needs different source and destination sub accounts.`;
      continue;
    }

    if (!rule.sourceWorkspaceId) return `Rule "${label}" needs a source workspace.`;
    if (!rule.sourceAccountId) return `Rule "${label}" needs a source bank account.`;
    if (!rule.sourceBudgetId) return `Rule "${label}" needs a source sub account.`;
  }
  return null;
}

function createEmptyAutoRule(destination: { sourceBudgetId?: string; destinationBudgetId?: string } = {}): AutoRule {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: "New rule",
    enabled: true,
    action: "DEDUCT_SAME_WORKSPACE",
    filters: [],
    sourceBudgetId: destination.sourceBudgetId ?? "",
    destinationBudgetId: destination.destinationBudgetId ?? "",
  };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});
  const [gmailMessage, setGmailMessage] = useState("");
  const [gmailSyncProgress, setGmailSyncProgress] = useState<GmailSyncProgress | null>(null);
  const [currencyMessage, setCurrencyMessage] = useState("");
  const [receivableAccountMessage, setReceivableAccountMessage] = useState("");
  const [publicNetWorthMessage, setPublicNetWorthMessage] = useState("");
  const [optimisticPublicNetWorthEnabled, setOptimisticPublicNetWorthEnabled] = useState<boolean | null>(null);
  const [autoRuleMessage, setAutoRuleMessage] = useState("");
  const [ruleDrafts, setRuleDrafts] = useState<AutoRule[]>([]);
  const [ruleDraftWorkspaceId, setRuleDraftWorkspaceId] = useState<string | null>(null);
  const [ruleKeywordInputs, setRuleKeywordInputs] = useState<Record<string, string>>({});
  const [editingAutoRuleId, setEditingAutoRuleId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("gmail");
    if (!status) return;
    if (status === "connected") setGmailMessage("Gmail connected successfully.");
    else if (status === "denied") setGmailMessage("Gmail permission was denied.");
    else if (status === "forbidden") setGmailMessage("Gmail callback failed authorization.");
    else setGmailMessage("Gmail connection failed.");
    url.searchParams.delete("gmail");
    window.history.replaceState({}, "", url.toString());
  }, []);

  // Add modal state
  const [name, setName] = useState("");
  const [selectedBankName, setSelectedBankName] = useState(SINGAPORE_BANKS[0].name);
  const [balance, setBalance] = useState("");
  const [description, setDescription] = useState("");

  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingBankName, setEditingBankName] = useState(SINGAPORE_BANKS[0].name);
  const [editingBalance, setEditingBalance] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingIsActive, setEditingIsActive] = useState(true);
  const [publicOrigin, setPublicOrigin] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPublicOrigin(window.location.origin);
  }, []);

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<Context>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId ?? null;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const defaultReceivableAccountId = context.data?.defaultAccountId ?? null;
  const defaultReceivableBudgetId = context.data?.defaultBudgetId ?? null;
  const savedPublicNetWorthEnabled = Boolean(context.data?.publicNetWorthEnabled);
  const publicNetWorthEnabled = optimisticPublicNetWorthEnabled ?? savedPublicNetWorthEnabled;
  const publicNetWorthToken = context.data?.publicNetWorthToken ?? null;
  const publicNetWorthUrl =
    publicNetWorthEnabled && publicNetWorthToken && publicOrigin
      ? `${publicOrigin}/api/public/net-worth/${publicNetWorthToken}`
      : "";

  const accounts = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const gmailStatus = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => fetchJson<GmailStatus>("/api/gmail/status"),
  });

  const budgets = useQuery({
    queryKey: ["budgets", workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const autoRules = useQuery({
    queryKey: ["credit-txn-auto-rules", workspaceId],
    queryFn: () => fetchJson<{ workspaceId: string; rules: AutoRule[] }>(`/api/credit-transactions/auto-rules?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!autoRules.data) return;
    if (ruleDraftWorkspaceId === workspaceId) return;
    setRuleDrafts(autoRules.data.rules);
    setRuleDraftWorkspaceId(workspaceId);
  }, [autoRules.data, ruleDraftWorkspaceId, workspaceId]);

  const workspaces = context.data?.workspaces ?? [];
  const sourceWorkspaceIds = useMemo(
    () => Array.from(new Set(
      ruleDrafts
        .filter((rule): rule is Extract<AutoRule, { action: "RECEIVABLE_OTHER_WORKSPACE" }> => rule.action === "RECEIVABLE_OTHER_WORKSPACE")
        .map((rule) => rule.sourceWorkspaceId)
        .filter(Boolean),
    )),
    [ruleDrafts],
  );

  const crossWorkspaceData = useQueries({
    queries: sourceWorkspaceIds.flatMap((targetWorkspaceId) => ([
      {
        queryKey: ["rule-bank-accounts", targetWorkspaceId],
        queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${targetWorkspaceId}`),
        enabled: Boolean(targetWorkspaceId),
      },
      {
        queryKey: ["rule-budgets", targetWorkspaceId],
        queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${targetWorkspaceId}`),
        enabled: Boolean(targetWorkspaceId),
      },
    ])),
  });

  const crossWorkspaceAccountsById = useMemo(() => {
    const map = new Map<string, BankAccount[]>();
    sourceWorkspaceIds.forEach((targetWorkspaceId, index) => {
      const result = crossWorkspaceData[index * 2];
      map.set(targetWorkspaceId, (result?.data as BankAccount[] | undefined) ?? []);
    });
    return map;
  }, [crossWorkspaceData, sourceWorkspaceIds]);

  const crossWorkspaceBudgetsById = useMemo(() => {
    const map = new Map<string, Budget[]>();
    sourceWorkspaceIds.forEach((targetWorkspaceId, index) => {
      const result = crossWorkspaceData[index * 2 + 1];
      map.set(targetWorkspaceId, (result?.data as Budget[] | undefined) ?? []);
    });
    return map;
  }, [crossWorkspaceData, sourceWorkspaceIds]);

  const hasAutoRuleChanges = useMemo(
    () => JSON.stringify(ruleDrafts) !== JSON.stringify(autoRules.data?.rules ?? []),
    [ruleDrafts, autoRules.data?.rules],
  );

  const defaultSameWorkspaceDestination = useMemo(() => {
    const activeBudgets = (budgets.data ?? []).filter((budget) => budget.isActive);
    const sourceBudgetId =
      activeBudgets.find((budget) => budget.id !== defaultReceivableBudgetId)?.id ?? activeBudgets[0]?.id ?? "";
    const preferredDestinationBudgetId =
      defaultReceivableBudgetId && defaultReceivableBudgetId !== sourceBudgetId && activeBudgets.some((budget) => budget.id === defaultReceivableBudgetId)
        ? defaultReceivableBudgetId
        : activeBudgets.find((budget) => budget.id !== sourceBudgetId)?.id ?? "";
    return { sourceBudgetId, destinationBudgetId: preferredDestinationBudgetId };
  }, [budgets.data, defaultReceivableBudgetId]);

  const connectGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ url: string }>("/api/gmail/connect", {
        method: "POST",
      }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => setGmailMessage(error instanceof Error ? error.message : "Failed to start Gmail connect."),
  });

  const syncGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ scannedMessages: number; processed: number; duplicates: number; failed: number; skipped?: boolean; reason?: string }>("/api/gmail/sync", {
        method: "POST",
      }),
    onSuccess: (data) => {
      const message = data.skipped && data.reason
        ? data.reason
        : `Synced ${data.scannedMessages} emails: ${data.processed} processed, ${data.duplicates} duplicates, ${data.failed} failed.`;
      setGmailMessage(message);
      setGmailSyncProgress((current) =>
        current
          ? {
              ...current,
              phase: "complete",
              progress: 100,
              message,
              total: data.scannedMessages,
              current: data.scannedMessages,
            }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Gmail sync failed.";
      setGmailMessage(message);
      setGmailSyncProgress((current) =>
        current
          ? {
              ...current,
              phase: "error",
              progress: 100,
              message,
            }
          : null,
      );
    },
  });

  useEffect(() => {
    if (!syncGmail.isPending) {
      if (gmailSyncProgress?.phase === "complete" || gmailSyncProgress?.phase === "error") {
        const timeout = window.setTimeout(() => setGmailSyncProgress(null), 1200);
        return () => window.clearTimeout(timeout);
      }
      return;
    }

    let cancelled = false;
    setGmailMessage("Syncing Gmail inbox...");
    setGmailSyncProgress({
      phase: "reading",
      progress: 0,
      message: "Starting sync...",
      total: 0,
      current: 0,
      updatedAt: Date.now(),
    });

    const poll = async () => {
      try {
        const progress = await fetchJson<GmailSyncProgress>("/api/gmail/sync");
        if (!cancelled) {
          setGmailSyncProgress(progress);
        }
      } catch {}
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [syncGmail.isPending]);

  useEffect(() => {
    if (!gmailStatus.data?.connected || syncGmail.isPending) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || syncGmail.isPending) return;
      syncGmail.mutate();
    }, GMAIL_SYNC_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [gmailStatus.data?.connected, syncGmail]);

  const disconnectGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ ok: true }>("/api/gmail/disconnect", {
        method: "POST",
      }),
    onSuccess: () => {
      setGmailMessage("Gmail disconnected.");
      queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
    },
    onError: (error) => setGmailMessage(error instanceof Error ? error.message : "Failed to disconnect Gmail."),
  });

  const updateCurrency = useMutation({
    mutationFn: (nextCurrency: string) =>
      fetchJson<{ workspaceId: string; baseCurrency: string }>("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          baseCurrency: nextCurrency,
        }),
      }),
    onSuccess: (data) => {
      setCurrencyMessage(`Currency updated to ${data.baseCurrency}.`);
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
    },
    onError: (error) => setCurrencyMessage(error instanceof Error ? error.message : "Failed to update currency."),
  });

  const updateReceivableDefaults = useMutation({
    mutationFn: (payload: { accountId?: string | null; budgetId?: string | null }) =>
      fetchJson<{ defaultAccountId: string | null }>("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          receivableDefaultAccountId: payload.accountId,
          receivableDefaultBudgetId: payload.budgetId,
        }),
      }),
    onSuccess: () => {
      setReceivableAccountMessage("Default receivable account updated.");
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
    },
    onError: (error) =>
      setReceivableAccountMessage(error instanceof Error ? error.message : "Failed to update default receivable account."),
  });

  const updatePublicNetWorth = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!workspaceId) throw new Error("No active workspace selected.");
      return fetchJson<{ publicNetWorthEnabled: boolean | null; publicNetWorthToken: string | null }>("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          publicNetWorthEnabled: enabled,
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Context>(["app-context"], (current) =>
        current
          ? {
              ...current,
              publicNetWorthEnabled: data.publicNetWorthEnabled,
              publicNetWorthToken: data.publicNetWorthToken,
            }
          : current,
      );
      setOptimisticPublicNetWorthEnabled(null);
      setPublicNetWorthMessage(data.publicNetWorthEnabled ? "Public net worth URL enabled." : "Public net worth URL disabled.");
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
    },
    onError: (error) => {
      setOptimisticPublicNetWorthEnabled(null);
      setPublicNetWorthMessage(error instanceof Error ? error.message : "Failed to update public net worth URL.");
    },
  });

  const onTogglePublicNetWorth = (enabled: boolean) => {
    setPublicNetWorthMessage("");
    setOptimisticPublicNetWorthEnabled(enabled);
    updatePublicNetWorth.mutate(enabled);
  };

  const copyPublicNetWorthUrl = async () => {
    if (!publicNetWorthUrl) return;
    try {
      await navigator.clipboard.writeText(publicNetWorthUrl);
      setPublicNetWorthMessage("Public net worth URL copied.");
    } catch {
      setPublicNetWorthMessage("Copy failed. Select the URL and copy it manually.");
    }
  };

  const saveAutoRules = useMutation({
    mutationFn: (rules: AutoRule[]) =>
      fetchJson<{ workspaceId: string; rules: AutoRule[] }>("/api/credit-transactions/auto-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          rules: rules.map(sanitizeAutoRule),
        }),
      }),
    onSuccess: (data) => {
      setRuleDrafts(data.rules);
      setRuleDraftWorkspaceId(data.workspaceId);
      setEditingAutoRuleId(null);
      setAutoRuleMessage(`Rules saved. Auto-accounting runs every ${Math.round(CREDIT_TXN_AUTO_ACCOUNT_INTERVAL_MS / 60000)} minutes.`);
      queryClient.invalidateQueries({ queryKey: ["credit-txn-auto-rules", workspaceId] });
    },
    onError: (error) => {
      setAutoRuleMessage(error instanceof Error ? error.message : "Failed to save auto-accounting rules.");
    },
  });

  const runAutoRules = useMutation({
    mutationFn: () =>
      fetchJson<{ ok: boolean; scanned: number; matched: number; accounted: number; skipped: number }>("/api/credit-transactions/auto-rules/run", {
        method: "POST",
      }),
    onSuccess: (data) => {
      setAutoRuleMessage(
        `Auto-accounted ${data.accounted} transaction${data.accounted === 1 ? "" : "s"} from ${data.matched} matched rule hits.`,
      );
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: (error) => {
      setAutoRuleMessage(error instanceof Error ? error.message : "Failed to run auto-accounting.");
    },
  });

  const createAccount = useMutation({
    mutationFn: () =>
      fetchJson<{ workspaceId: string }>("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspaceId || undefined,
          name,
          bankName: selectedBankName,
          startingCents: Math.round(Number(balance || "0") * 100),
          description: description || undefined,
        }),
      }),
    onSuccess: () => {
      closeAddModal();
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const updateAccount = useMutation({
    mutationFn: (payload: {
      id: string;
      name: string;
      bankName: string;
      description?: string | null;
      startingCents: number;
      isActive: boolean;
    }) =>
      fetchJson(`/api/accounts/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          bankName: payload.bankName,
          description: payload.description,
          startingCents: payload.startingCents,
          isActive: payload.isActive,
        }),
      }),
    onSuccess: () => {
      closeEditModal();
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const openAddModal = () => {
    setName("");
    setSelectedBankName(SINGAPORE_BANKS[0].name);
    setBalance("");
    setDescription("");
    setIsAddModalOpen(true);
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setName("");
    setSelectedBankName(SINGAPORE_BANKS[0].name);
    setBalance("");
    setDescription("");
  };

  const openEditModal = (account: BankAccount) => {
    setEditingAccountId(account.id);
    setEditingName(account.name);
    setEditingBankName(account.bankName || SINGAPORE_BANKS[0].name);
    setEditingBalance((account.startingCents / 100).toFixed(2));
    setEditingDescription(account.description || "");
    setEditingIsActive(account.isActive);
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingAccountId(null);
    setEditingName("");
    setEditingBankName(SINGAPORE_BANKS[0].name);
    setEditingBalance("");
    setEditingDescription("");
    setEditingIsActive(true);
  };

  const onSubmitAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() && !selectedBankName) return;
    createAccount.mutate();
  };

  const onSubmitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingAccountId) return;
    updateAccount.mutate({
      id: editingAccountId,
      name: editingName.trim(),
      bankName: editingBankName,
      description: editingDescription.trim() || null,
      startingCents: Math.round(Number(editingBalance || "0") * 100),
      isActive: editingIsActive,
    });
  };

  const updateDraftRule = (id: string, updater: (rule: AutoRule) => AutoRule) => {
    setRuleDrafts((current) => current.map((rule) => (rule.id === id ? updater(rule) : rule)));
  };

  const setRuleFilters = (id: string, filters: string[]) => {
    const nextFilters = filters.map((filter) => filter.trim()).filter(Boolean);
    updateDraftRule(id, (current) => ({ ...current, filters: nextFilters }));
  };

  const addRuleFilter = (id: string) => {
    const keyword = (ruleKeywordInputs[id] ?? "").trim();
    if (!keyword) return;
    const rule = ruleDrafts.find((item) => item.id === id);
    if (!rule) return;
    setRuleFilters(id, [...rule.filters, keyword]);
    setRuleKeywordInputs((current) => ({ ...current, [id]: "" }));
  };

  const removeRuleFilter = (id: string, filterIndex: number) => {
    const rule = ruleDrafts.find((item) => item.id === id);
    if (!rule) return;
    setRuleFilters(id, rule.filters.filter((_, index) => index !== filterIndex));
  };

  const moveRule = (id: string, direction: -1 | 1) => {
    setRuleDrafts((current) => {
      const index = current.findIndex((rule) => rule.id === id);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const removeRule = (id: string) => {
    if (editingAutoRuleId === id) setEditingAutoRuleId(null);
    setRuleDrafts((current) => current.filter((rule) => rule.id !== id));
    setRuleKeywordInputs((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const addRule = () => {
    const nextRule = createEmptyAutoRule(defaultSameWorkspaceDestination);
    setRuleDrafts((current) => [...current, nextRule]);
    setEditingAutoRuleId(nextRule.id);
    setAutoRuleMessage("New rule added. Add at least one subject keyword before saving.");
  };

  const onSaveAutoRules = () => {
    if (!workspaceId) return;
    const validationMessage = getAutoRuleValidationMessage(ruleDrafts);
    if (validationMessage) {
      setAutoRuleMessage(validationMessage);
      return;
    }
    saveAutoRules.mutate(ruleDrafts.map(sanitizeAutoRule));
  };

  const getWorkspaceName = (id: string) => workspaces.find((workspace) => workspace.id === id)?.name || "Workspace";

  const getAccountName = (id: string, sourceWorkspaceId?: string) => {
    if (sourceWorkspaceId) {
      return crossWorkspaceAccountsById.get(sourceWorkspaceId)?.find((account) => account.id === id)?.name || "Bank account";
    }
    return accounts.data?.find((account) => account.id === id)?.name || "Bank account";
  };

  const getBudgetName = (id: string, sourceWorkspaceId?: string) => {
    if (sourceWorkspaceId) {
      return crossWorkspaceBudgetsById.get(sourceWorkspaceId)?.find((budget) => budget.id === id)?.name || "Sub account";
    }
    return budgets.data?.find((budget) => budget.id === id)?.name || "Sub account";
  };

  const getRuleActionLabel = (rule: AutoRule) =>
    rule.action === "DEDUCT_SAME_WORKSPACE"
      ? "Transfer same workspace"
      : "Create receivable";

  const getRuleTargetLabel = (rule: AutoRule) => {
    if (rule.action === "DEDUCT_SAME_WORKSPACE") {
      return `${getBudgetName(rule.sourceBudgetId)} -> ${getBudgetName(rule.destinationBudgetId)}`;
    }
    return `${getWorkspaceName(rule.sourceWorkspaceId)} · ${getAccountName(rule.sourceAccountId, rule.sourceWorkspaceId)} · ${getBudgetName(rule.sourceBudgetId, rule.sourceWorkspaceId)}`;
  };

  const editingAutoRule = editingAutoRuleId ? ruleDrafts.find((rule) => rule.id === editingAutoRuleId) ?? null : null;
  const editingAutoRuleIndex = editingAutoRule ? ruleDrafts.findIndex((rule) => rule.id === editingAutoRule.id) : -1;
  const editingSameWorkspaceBudgets = editingAutoRule?.action === "DEDUCT_SAME_WORKSPACE"
    ? (budgets.data ?? []).filter((budget) => budget.isActive)
    : [];
  const editingSourceAccounts = editingAutoRule?.action === "RECEIVABLE_OTHER_WORKSPACE"
    ? (crossWorkspaceAccountsById.get(editingAutoRule.sourceWorkspaceId) ?? []).filter((account) => account.isActive)
    : [];
  const editingSourceBudgets = editingAutoRule?.action === "RECEIVABLE_OTHER_WORKSPACE"
    ? (crossWorkspaceBudgetsById.get(editingAutoRule.sourceWorkspaceId) ?? []).filter(
        (budget) => budget.isActive && budget.accountId === editingAutoRule.sourceAccountId,
      )
    : [];

  return (
    <div className="st-container">
      <div className="card settings-card-block gmail-alerts-card">
        <div className="gmail-alerts-header">
          <div className="gmail-alerts-copy">
            <div className="gmail-alerts-title-row">
              <div className="settings-section-title">Gmail Card Alerts</div>
              <a
                href="/credit-alerts"
                target="_blank"
                rel="noreferrer"
                className="settings-inline-link"
              >
                Open Staging Table
              </a>
            </div>
            <div className="settings-section-copy">
              Authorize once for read-only Gmail access. Nest only scans card transaction alert emails, extracts transaction details,
              and auto-adds them to Credit Card Transactions for tracking. Nest does not send, delete, or modify your emails.
            </div>
          </div>
          {gmailStatus.data?.connected ? (
            <div className="gmail-alerts-actions">
              <button className="btn btn-ghost btn-xs" onClick={() => syncGmail.mutate()} disabled={syncGmail.isPending}>
                {syncGmail.isPending ? "Syncing..." : "Sync Inbox"}
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => disconnectGmail.mutate()} disabled={disconnectGmail.isPending}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-xs" onClick={() => connectGmail.mutate()} disabled={connectGmail.isPending}>
              {connectGmail.isPending ? "Redirecting..." : "Connect Gmail"}
            </button>
          )}
        </div>
        {gmailStatus.data?.connected && gmailStatus.data.integration ? (
          <div className="settings-message">
            Connected: <strong>{gmailStatus.data.integration.email}</strong>
            {gmailStatus.data.integration.lastSyncedAt
              ? ` · Last sync: ${new Date(gmailStatus.data.integration.lastSyncedAt).toLocaleString()}`
              : " · Never synced"}
          </div>
        ) : (
          <div className="settings-muted-message">Not connected.</div>
        )}
        {gmailSyncProgress ? (
          <div className="gmail-sync-progress-wrap" aria-label="Gmail inbox sync progress" aria-live="polite">
            <progress className="gmail-sync-progress" value={Math.min(gmailSyncProgress.progress, 100)} max={100} />
            <div className="gmail-sync-progress-text">
              {gmailSyncProgress.message || `Syncing inbox ${Math.round(gmailSyncProgress.progress)}%`}
            </div>
          </div>
        ) : null}
        {gmailMessage ? <div className="settings-message settings-message-spaced">{gmailMessage}</div> : null}
      </div>

      <div className="card settings-card-block">
        <div className="settings-row">
          <div>
            <div className="settings-section-title">Currency Display</div>
            <div className="settings-section-copy">
              Set currency display across your workspace. Default is SGD.
            </div>
          </div>
          <select
            className="input settings-select-sm"
            value={baseCurrency}
            onChange={(event) => updateCurrency.mutate(event.target.value)}
            disabled={!workspaceId || updateCurrency.isPending}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        {currencyMessage ? <div className="settings-message">{currencyMessage}</div> : null}
      </div>

      <div className="card settings-card-block">
        <div className="settings-row">
          <div>
            <div className="settings-section-title">Public Net Worth API</div>
            <div className="settings-section-copy">
              Read-only JSON endpoint for the current workspace.
            </div>
          </div>
          <label className="auto-rule-switch" aria-label="Public net worth API enabled">
            <input
              type="checkbox"
              checked={publicNetWorthEnabled}
              onChange={(event) => onTogglePublicNetWorth(event.target.checked)}
              disabled={!workspaceId || updatePublicNetWorth.isPending}
            />
            <span />
          </label>
        </div>
        {publicNetWorthEnabled ? (
          <div className="settings-row settings-row-spaced">
            <div>
              <div className="settings-section-title">Fixed URL</div>
              <div className="settings-section-copy">
                Returns amount, base, and currency only.
              </div>
            </div>
            <div className="settings-public-url-row">
              <input className="input" value={publicNetWorthUrl || "Generating URL..."} readOnly />
              <button
                className="btn btn-ghost btn-xs"
                type="button"
                onClick={copyPublicNetWorthUrl}
                disabled={!publicNetWorthUrl}
              >
                <Copy size={14} aria-hidden="true" />
                Copy
              </button>
            </div>
          </div>
        ) : null}
        {publicNetWorthMessage ? <div className="settings-message">{publicNetWorthMessage}</div> : null}
      </div>

      <div className="card settings-card-block">
        <div className="settings-row">
          <div>
            <div className="settings-section-title">Receivable Default Account</div>
            <div className="settings-section-copy">
              Closed receivables are credited into this account automatically.
            </div>
          </div>
          <select
            className="input settings-select-md"
            value={defaultReceivableAccountId ?? ""}
            onChange={(event) =>
              updateReceivableDefaults.mutate({
                accountId: event.target.value || null,
                budgetId: null,
              })
            }
            disabled={!workspaceId || accounts.isLoading || updateReceivableDefaults.isPending}
          >
            <option value="">Not configured</option>
            {(accounts.data ?? []).filter((a) => a.isActive).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row settings-row-spaced">
          <div>
            <div className="settings-section-title">Receivable Default Subaccount</div>
            <div className="settings-section-copy">
              Closed receivables are posted into this subaccount under the default account.
            </div>
          </div>
          <select
            className="input settings-select-md"
            value={defaultReceivableBudgetId ?? ""}
            onChange={(event) =>
              updateReceivableDefaults.mutate({
                accountId: undefined,
                budgetId: event.target.value || null,
              })
            }
            disabled={!workspaceId || !defaultReceivableAccountId || budgets.isLoading || updateReceivableDefaults.isPending}
          >
            <option value="">Not configured</option>
            {(budgets.data ?? [])
              .filter((b) => b.isActive && b.accountId === defaultReceivableAccountId)
              .map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
          </select>
        </div>
        {receivableAccountMessage ? <div className="settings-message">{receivableAccountMessage}</div> : null}
      </div>

      <div className="card settings-card-block">
        <div className="settings-auto-header">
          <div className="settings-auto-copy">
            <div className="settings-section-title">Credit Card Auto Accounting</div>
            <div className="settings-section-copy settings-auto-description">
              Ordered rules match unaccounted credit card transaction subjects using case-insensitive contains filters. First match wins.
              Matching transactions are auto-accounted every 5 minutes.
            </div>
          </div>
          <div className="settings-auto-actions">
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => setRuleDrafts(autoRules.data?.rules ?? [])} disabled={saveAutoRules.isPending || runAutoRules.isPending || !hasAutoRuleChanges}>
              <RotateCcw size={14} aria-hidden="true" />
              Reset
            </button>
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => runAutoRules.mutate()} disabled={!workspaceId || runAutoRules.isPending}>
              <Play size={14} aria-hidden="true" />
              {runAutoRules.isPending ? "Running..." : "Run Now"}
            </button>
            <button className="btn btn-primary btn-xs" type="button" onClick={onSaveAutoRules} disabled={!workspaceId || saveAutoRules.isPending || !hasAutoRuleChanges}>
              <Save size={14} aria-hidden="true" />
              {saveAutoRules.isPending ? "Saving..." : "Save Rules"}
            </button>
          </div>
        </div>

        {autoRules.isLoading ? (
          <SettingsAutoRulesSkeleton />
        ) : autoRules.isError ? (
          <EmptyState
            icon="⚠️"
            title="Failed to load auto-accounting rules"
            description="Refresh the page and try again."
          />
        ) : (
          <div className="auto-rules-shell">
            <div className="auto-rules-stack">
              {ruleDrafts.map((rule, index) => (
                <div key={rule.id} className={`auto-rule-card ${rule.enabled ? "" : "is-disabled"}`}>
                  <button className="auto-rule-summary" type="button" onClick={() => setEditingAutoRuleId(rule.id)}>
                    <span className="auto-rule-number">{index + 1}</span>
                    <span className="auto-rule-main">
                      <span className="auto-rule-title-row">
                        <span className="auto-rule-title">{rule.name || `Rule ${index + 1}`}</span>
                        {!rule.enabled ? <span className="auto-rule-muted-pill">Paused</span> : null}
                      </span>
                      <span className="auto-rule-flow" aria-label="Rule summary">
                        <span className="auto-rule-chip auto-rule-chip-filter">
                          {rule.filters[0] || "No keyword"}
                        </span>
                        {rule.filters.length > 1 ? (
                          <span className="auto-rule-more">+{rule.filters.length - 1}</span>
                        ) : null}
                        <ArrowRight size={16} aria-hidden="true" />
                        <span className="auto-rule-chip auto-rule-chip-action">{getRuleActionLabel(rule)}</span>
                        <span className="auto-rule-separator">·</span>
                        <span className="auto-rule-chip auto-rule-chip-target">{getRuleTargetLabel(rule)}</span>
                      </span>
                    </span>
                    <span className="auto-rule-summary-actions" onClick={(event) => event.stopPropagation()}>
                      <label className="auto-rule-switch" aria-label={`${rule.name} enabled`}>
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(event) => updateDraftRule(rule.id, (current) => ({ ...current, enabled: event.target.checked }))}
                        />
                        <span />
                      </label>
                    </span>
                  </button>
                </div>
              ))}
            </div>

            <div className="auto-rule-footer">
              <button className="btn btn-ghost btn-xs" type="button" onClick={addRule}>
                <Plus size={14} aria-hidden="true" />
                Add Rule
              </button>
              <div className="auto-rule-footnote">
                Rules are checked top to bottom. Only unaccounted credit card transactions are affected.
              </div>
            </div>
          </div>
        )}

        {autoRuleMessage ? <div className="settings-message settings-message-auto">{autoRuleMessage}</div> : null}
      </div>

      {editingAutoRule && (
        <div className="auto-rule-modal-overlay" onDoubleClick={(event) => closeOnBackdropDoubleClick(event, () => setEditingAutoRuleId(null))}>
          <div className="auto-rule-modal" role="dialog" aria-modal="true" aria-labelledby="auto-rule-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="auto-rule-modal-header">
              <div className="auto-rule-modal-title-wrap">
                <span className="auto-rule-number">{editingAutoRuleIndex + 1}</span>
                <div>
                  <h3 id="auto-rule-modal-title">Edit Auto Accounting Rule</h3>
                  <p>{editingAutoRule.name || `Rule ${editingAutoRuleIndex + 1}`}</p>
                </div>
              </div>
              <button className="auto-rule-icon-btn" type="button" onClick={() => setEditingAutoRuleId(null)} aria-label="Close editor">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="auto-rule-modal-body">
              <div className="auto-rule-editor-hero">
                <div className="auto-rule-hero-step">
                  <span>Subject</span>
                  <strong>{editingAutoRule.filters[0] || "Add keyword"}</strong>
                </div>
                <ArrowRight className="auto-rule-hero-arrow" size={22} aria-hidden="true" />
                <div className="auto-rule-hero-step">
                  <span>Action</span>
                  <strong>{getRuleActionLabel(editingAutoRule)}</strong>
                </div>
                <ArrowRight className="auto-rule-hero-arrow" size={22} aria-hidden="true" />
                <div className="auto-rule-hero-step">
                  <span>Posting</span>
                  <strong>{getRuleTargetLabel(editingAutoRule)}</strong>
                </div>
              </div>

              <div className="auto-rule-editor-grid">
                <section className="auto-rule-edit-section">
                  <div className="auto-rule-section-label">Rule Name</div>
                  <input
                    className="input"
                    type="text"
                    value={editingAutoRule.name}
                    onChange={(event) => updateDraftRule(editingAutoRule.id, (current) => ({ ...current, name: event.target.value }))}
                  />
                </section>

                <section className="auto-rule-edit-section">
                  <div className="auto-rule-section-label">Status</div>
                  <label className="auto-rule-enable-row">
                    <span>Rule is active</span>
                    <span className="auto-rule-switch">
                      <input
                        type="checkbox"
                        checked={editingAutoRule.enabled}
                        onChange={(event) => updateDraftRule(editingAutoRule.id, (current) => ({ ...current, enabled: event.target.checked }))}
                      />
                      <span />
                    </span>
                  </label>
                </section>

                <section className="auto-rule-edit-section auto-rule-span">
                  <div className="auto-rule-section-label">Action</div>
                  <div className="auto-rule-action-row">
                    <span className="auto-rule-action-cue">
                      <ArrowRight size={17} aria-hidden="true" />
                      When matched
                      <ArrowRight size={17} aria-hidden="true" />
                    </span>
                    <select
                      className="input"
                      value={editingAutoRule.action}
                      onChange={(event) =>
                        updateDraftRule(editingAutoRule.id, (current) =>
                          event.target.value === "DEDUCT_SAME_WORKSPACE"
                            ? {
                                id: current.id,
                                name: current.name,
                                enabled: current.enabled,
                                action: "DEDUCT_SAME_WORKSPACE",
                                filters: current.filters,
                                sourceBudgetId: defaultSameWorkspaceDestination.sourceBudgetId,
                                destinationBudgetId: defaultSameWorkspaceDestination.destinationBudgetId,
                              }
                            : {
                                id: current.id,
                                name: current.name,
                                enabled: current.enabled,
                                action: "RECEIVABLE_OTHER_WORKSPACE",
                                filters: current.filters,
                                sourceWorkspaceId: workspaces.find((workspace) => workspace.id !== workspaceId)?.id ?? "",
                                sourceAccountId: "",
                                sourceBudgetId: "",
                              },
                        )
                      }
                    >
                      <option value="DEDUCT_SAME_WORKSPACE">Transfer between same-workspace sub accounts</option>
                      <option value="RECEIVABLE_OTHER_WORKSPACE">Create receivable from another workspace</option>
                    </select>
                  </div>
                </section>

                <section className="auto-rule-edit-section auto-rule-span">
                  <div className="auto-rule-section-divider">
                    <span>Subject Filters</span>
                  </div>
                  <div className="auto-rule-keyword-box">
                    <div className="auto-rule-keywords">
                      {editingAutoRule.filters.map((filter, index) => (
                        <span key={`${filter}-${index}`} className="auto-rule-keyword">
                          {filter}
                          <button type="button" onClick={() => removeRuleFilter(editingAutoRule.id, index)} aria-label={`Remove ${filter}`}>
                            <X size={14} aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="auto-rule-add-keyword">
                      <input
                        className="input"
                        type="text"
                        value={ruleKeywordInputs[editingAutoRule.id] ?? ""}
                        onChange={(event) => setRuleKeywordInputs((current) => ({ ...current, [editingAutoRule.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          addRuleFilter(editingAutoRule.id);
                        }}
                        placeholder="Add keyword..."
                      />
                      <button className="btn btn-ghost" type="button" onClick={() => addRuleFilter(editingAutoRule.id)}>
                        <Plus size={15} aria-hidden="true" />
                        Add
                      </button>
                    </div>
                    <div className="auto-rule-helper">Any line can match · case-insensitive</div>
                  </div>
                </section>

                {editingAutoRule.action === "DEDUCT_SAME_WORKSPACE" ? (
                  <section className="auto-rule-edit-section auto-rule-span">
                    <div className="auto-rule-section-divider">
                      <span>Source and Destination</span>
                    </div>
                    <div className="auto-rule-field-grid">
                      <label>
                        <span>Source Sub Account</span>
                        <select
                          className="input"
                          value={editingAutoRule.sourceBudgetId}
                          onChange={(event) =>
                            updateDraftRule(editingAutoRule.id, (current) =>
                              current.action === "DEDUCT_SAME_WORKSPACE"
                                ? { ...current, sourceBudgetId: event.target.value }
                                : current,
                            )
                          }
                        >
                          <option value="">Select source sub account</option>
                          {editingSameWorkspaceBudgets.map((budget) => (
                            <option key={budget.id} value={budget.id}>
                              {budget.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Destination Sub Account</span>
                        <select
                          className="input"
                          value={editingAutoRule.destinationBudgetId}
                          onChange={(event) =>
                            updateDraftRule(editingAutoRule.id, (current) =>
                              current.action === "DEDUCT_SAME_WORKSPACE"
                                ? { ...current, destinationBudgetId: event.target.value }
                                : current,
                            )
                          }
                        >
                          <option value="">Select sub account</option>
                          {editingSameWorkspaceBudgets.map((budget) => (
                            <option key={budget.id} value={budget.id}>
                              {budget.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </section>
                ) : (
                  <section className="auto-rule-edit-section auto-rule-span">
                    <div className="auto-rule-section-divider">
                      <span>Source</span>
                    </div>
                    <div className="auto-rule-field-grid auto-rule-field-grid-three">
                      <label>
                        <span>Workspace</span>
                        <select
                          className="input"
                          value={editingAutoRule.sourceWorkspaceId}
                          onChange={(event) =>
                            updateDraftRule(editingAutoRule.id, (current) =>
                              current.action === "RECEIVABLE_OTHER_WORKSPACE"
                                ? {
                                    ...current,
                                    sourceWorkspaceId: event.target.value,
                                    sourceAccountId: "",
                                    sourceBudgetId: "",
                                  }
                                : current,
                            )
                          }
                        >
                          <option value="">Select workspace</option>
                          {workspaces.filter((workspace) => workspace.id !== workspaceId).map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Bank Account</span>
                        <select
                          className="input"
                          value={editingAutoRule.sourceAccountId}
                          onChange={(event) =>
                            updateDraftRule(editingAutoRule.id, (current) => {
                              if (current.action !== "RECEIVABLE_OTHER_WORKSPACE") return current;
                              const nextAccountId = event.target.value;
                              const nextBudgetId =
                                (crossWorkspaceBudgetsById.get(current.sourceWorkspaceId) ?? []).find(
                                  (budget) => budget.isActive && budget.accountId === nextAccountId,
                                )?.id ?? "";
                              return {
                                ...current,
                                sourceAccountId: nextAccountId,
                                sourceBudgetId: nextBudgetId,
                              };
                            })
                          }
                        >
                          <option value="">Select bank account</option>
                          {editingSourceAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Sub Account</span>
                        <select
                          className="input"
                          value={editingAutoRule.sourceBudgetId}
                          onChange={(event) =>
                            updateDraftRule(editingAutoRule.id, (current) =>
                              current.action === "RECEIVABLE_OTHER_WORKSPACE"
                                ? { ...current, sourceBudgetId: event.target.value }
                                : current,
                            )
                          }
                        >
                          <option value="">Select sub account</option>
                          {editingSourceBudgets.map((budget) => (
                            <option key={budget.id} value={budget.id}>
                              {budget.name}
                              {budget.receivableReservedCents ? ` (${formatMoney(budget.receivableReservedCents, baseCurrency)})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="auto-rule-helper">Open receivables earmarked against the selected source sub account are shown in brackets.</div>
                  </section>
                )}
              </div>
            </div>

            <div className="auto-rule-modal-footer">
              <div className="auto-rule-order-actions">
                <button className="btn btn-ghost" type="button" onClick={() => moveRule(editingAutoRule.id, -1)} disabled={editingAutoRuleIndex <= 0}>
                  <ChevronUp size={15} aria-hidden="true" />
                  Move up
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => moveRule(editingAutoRule.id, 1)} disabled={editingAutoRuleIndex < 0 || editingAutoRuleIndex >= ruleDrafts.length - 1}>
                  <ChevronDown size={15} aria-hidden="true" />
                  Move down
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => removeRule(editingAutoRule.id)}>
                  <Trash2 size={15} aria-hidden="true" />
                  Delete rule
                </button>
              </div>
              <div className="auto-rule-modal-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setEditingAutoRuleId(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="button" onClick={onSaveAutoRules} disabled={!workspaceId || saveAutoRules.isPending || !hasAutoRuleChanges}>
                  {saveAutoRules.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data Import Section */}
      <DataImportSection workspaceId={workspaceId} baseCurrency={baseCurrency} />

      {/* Header with Add Button */}
      <div className="st-header">
        <h2 className="st-title">Bank Accounts</h2>
        <button className="btn btn-primary" onClick={openAddModal}>
          + Add Account
        </button>
      </div>

      {/* Accounts Grid */}
      <div className="st-grid">
        {accounts.isLoading && <SettingsBankAccountsSkeleton />}

        {accounts.isError && (
          <div className="st-empty">
            <div className="st-empty-icon">⚠️</div>
            <p>Failed to load accounts</p>
            <button className="btn btn-primary" onClick={() => accounts.refetch()}>
              Retry
            </button>
          </div>
        )}

        {!accounts.isLoading && !accounts.isError && accounts.data?.map((account) => {
          const bank = getSingaporeBankByName(account.bankName);
          const logo = getBankLogoUrl(bank);
          const hasDiscrepancy = account.discrepancyCents !== 0;

          return (
            <div key={account.id} className={`st-card ${!account.isActive ? 'inactive' : ''}`}>
              <div className="st-card-header">
                <div className="st-card-bank">
                  {logo && !failedLogos[account.id] ? (
                    <Image
                      src={logo}
                      alt={bank?.name || "Bank"}
                      width={40}
                      height={24}
                      sizes="40px"
                      className="st-bank-logo"
                      loading="lazy"
                      onError={() => setFailedLogos((prev) => ({ ...prev, [account.id]: true }))}
                    />
                  ) : bank ? (
                    <span className={`st-bank-fallback st-bank-fallback-${bank.code.toLowerCase()}`}>
                      {bank.short}
                    </span>
                  ) : (
                    <span className="st-bank-fallback st-bank-fallback-default">
                      BNK
                    </span>
                  )}
                </div>
                <div className="st-card-actions">
                  <button className="btn btn-ghost btn-xs" onClick={() => openEditModal(account)}>
                    Edit
                  </button>
                </div>
              </div>

              <div className="st-card-body">
                <h3 className="st-card-name">{account.name}</h3>
                <p className="st-card-bankname">{account.bankName || "Bank"}</p>
                {account.description && (
                  <p className="st-card-desc">{account.description}</p>
                )}
              </div>

              <div className="st-card-stats">
                <div className="st-stat">
                  <span className="st-stat-label">Balance</span>
                  <span className={`st-stat-value ${hasDiscrepancy ? 'warning' : ''}`}>
                    {formatMoney(account.currentBalanceCents, baseCurrency)}
                  </span>
                </div>
                <div className="st-stat">
                  <span className="st-stat-label">In Budgets</span>
                  <span className="st-stat-value">{formatMoney(account.linkedBudgetTotalCents, baseCurrency)}</span>
                </div>
              </div>

              {hasDiscrepancy && (
                <div className="st-discrepancy">
                  <span className="st-discrepancy-icon">⚠️</span>
                  <span className="st-discrepancy-text">
                    Discrepancy: {account.discrepancyCents > 0 ? "+" : ""}
                    {formatMoney(account.discrepancyCents, baseCurrency)}
                  </span>
                </div>
              )}

              {!account.isActive && (
                <div className="st-inactive-badge">Inactive</div>
              )}
            </div>
          );
        })}

        {/* Add New Card Placeholder - only show when data loaded and has accounts */}
        {!accounts.isLoading && !accounts.isError && accounts.data && accounts.data.length > 0 && (
          <button className="st-add-card" onClick={openAddModal}>
            <div className="st-add-icon">+</div>
            <span>Add Bank Account</span>
            <p className="st-add-hint">Connect a new bank to track your finances</p>
          </button>
        )}

        {/* Empty State */}
        {!accounts.isLoading && !accounts.isError && accounts.data?.length === 0 && (
          <div className="st-grid-empty">
            <EmptyState
              icon="🏦"
              title="No bank accounts yet"
              description="Connect your first bank account to start tracking your finances and managing budgets."
              action={
                <button className="btn btn-primary" onClick={openAddModal}>
                  + Add Your First Account
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      {isAddModalOpen && (
        <div className="st-modal-overlay" onDoubleClick={(event) => closeOnBackdropDoubleClick(event, closeAddModal)}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Bank Account</h3>
              <button className="st-close-btn" onClick={closeAddModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitAdd}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Bank</label>
                  <select
                    className="input"
                    value={selectedBankName}
                    onChange={(e) => setSelectedBankName(e.target.value)}
                  >
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Account Name</label>
                  <input
                    className="input"
                    placeholder="e.g., DBS Savings"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <span className="st-hint">If left empty, the bank name will be used</span>
                </div>
                <div className="form-group">
                  <label className="label">Starting Balance</label>
                  <NumericCalculatorInput
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={balance}
                    onValueChange={setBalance}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Description</label>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              {createAccount.isError && (
                <div className="st-error">
                  Failed to save: {(createAccount.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeAddModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createAccount.isPending}>
                  {createAccount.isPending ? "Adding..." : "Add Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {isEditModalOpen && editingAccountId && (
        <div className="st-modal-overlay" onDoubleClick={(event) => closeOnBackdropDoubleClick(event, closeEditModal)}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Edit Bank Account</h3>
              <button className="st-close-btn" onClick={closeEditModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitEdit}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Bank</label>
                  <select
                    className="input"
                    value={editingBankName}
                    onChange={(e) => setEditingBankName(e.target.value)}
                  >
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Account Name</label>
                  <input
                    className="input"
                    placeholder="Account name"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Balance</label>
                  <NumericCalculatorInput
                    min="0"
                    step="0.01"
                    value={editingBalance}
                    onValueChange={setEditingBalance}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={editingIsActive ? "ACTIVE" : "INACTIVE"}
                    onChange={(e) => setEditingIsActive(e.target.value === "ACTIVE")}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Description</label>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                  />
                </div>
              </div>
              {updateAccount.isError && (
                <div className="st-error">
                  Failed to update: {(updateAccount.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeEditModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={updateAccount.isPending}>
                  {updateAccount.isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
