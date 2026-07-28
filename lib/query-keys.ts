import type { QueryClient } from "@tanstack/react-query";

export type QueryRoot =
  | "app-context"
  | "bank-accounts"
  | "budget-plan"
  | "budgets"
  | "collaborators"
  | "credit-cards"
  | "credit-transactions"
  | "credit-transaction-payment-due-months"
  | "credit-txn-auto-rules"
  | "dashboard-summary"
  | "gmail-status"
  | "in-app-notifications"
  | "investments"
  | "payment-due-months"
  | "receivable-budget-summary"
  | "receivables"
  | "receivables-summary"
  | "reward-history"
  | "rewards"
  | "rule-bank-accounts"
  | "rule-budgets"
  | "settings-auth-providers"
  | "settings-linked-accounts"
  | "settings-login-sessions"
  | "settings-passkeys"
  | "settings-push-status"
  | "smart-review"
  | "transaction-group-detail"
  | "transaction-groups"
  | "transaction-months"
  | "transactions"
  | "workspaces";

type WorkspaceId = string | null | undefined;
type TypedQueryKey = readonly [QueryRoot, ...unknown[]];

const workspaceDataRoots = [
  "bank-accounts",
  "budget-plan",
  "budgets",
  "collaborators",
  "credit-cards",
  "credit-transactions",
  "credit-txn-auto-rules",
  "dashboard-summary",
  "gmail-status",
  "investments",
  "receivables",
  "receivables-summary",
  "rewards",
  "smart-review",
  "transaction-groups",
  "transaction-months",
  "transactions",
] as const satisfies readonly QueryRoot[];

export const queryKeys = {
  key: <const T extends TypedQueryKey>(value: T) => value,
  all: <const T extends QueryRoot>(root: T) => [root] as const,
  scoped: <const T extends QueryRoot, const P extends readonly unknown[]>(
    root: T,
    workspaceId: WorkspaceId,
    ...parts: P
  ) => [root, workspaceId, ...parts] as const,
  contextAll: ["app-context"] as const,
  context: (workspaceId?: WorkspaceId) => ["app-context", workspaceId] as const,
  dashboardAll: ["dashboard-summary"] as const,
  dashboard: (workspaceId?: WorkspaceId) => ["dashboard-summary", workspaceId] as const,
  collaboratorsAll: ["collaborators"] as const,
  collaborators: (workspaceId?: WorkspaceId) => ["collaborators", workspaceId] as const,
  notificationsAll: ["in-app-notifications"] as const,
  notifications: (workspaceId?: WorkspaceId) => ["in-app-notifications", workspaceId] as const,
  investments: (workspaceId?: WorkspaceId) => ["investments", workspaceId] as const,
  rewardHistory: (workspaceId?: WorkspaceId, accountId?: string | null) =>
    ["reward-history", workspaceId, accountId] as const,
  transactions: (workspaceId?: WorkspaceId, ...parts: readonly unknown[]) =>
    ["transactions", workspaceId, ...parts] as const,
  workspaceDataRoots,
} as const;

export async function invalidateWorkspaceQueries(
  client: QueryClient,
  workspaceId?: WorkspaceId,
  options: { refetchType?: "active" | "all" | "inactive" | "none" } = {},
) {
  await Promise.all(workspaceDataRoots.map((root) => client.invalidateQueries({
    queryKey: workspaceId ? [root, workspaceId] : [root],
    refetchType: options.refetchType ?? "active",
  })));
}

export function removeWorkspaceQueries(client: QueryClient, workspaceId?: WorkspaceId) {
  for (const root of workspaceDataRoots) {
    client.removeQueries({ queryKey: workspaceId ? [root, workspaceId] : [root] });
  }
}
