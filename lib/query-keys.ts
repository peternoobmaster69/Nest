export const queryKeys = {
  contextAll: ["app-context"] as const,
  context: (workspaceId?: string | null) => ["app-context", workspaceId] as const,
  dashboardAll: ["dashboard-summary"] as const,
  dashboard: (workspaceId?: string | null) => ["dashboard-summary", workspaceId] as const,
  collaboratorsAll: ["collaborators"] as const,
  collaborators: (workspaceId?: string | null) => ["collaborators", workspaceId] as const,
  notificationsAll: ["in-app-notifications"] as const,
  notifications: (workspaceId?: string | null) => ["in-app-notifications", workspaceId] as const,
  rewardHistory: (workspaceId?: string | null, accountId?: string | null) =>
    ["reward-history", workspaceId, accountId] as const,
  transactions: (workspaceId?: string | null) => ["transactions", workspaceId] as const,
} as const;
