import type { ListEnvelope } from "@/lib/api/contracts";

// Default visibility for configurable workspace navigation.
export const DEFAULT_NAVIGATION_PAGES = {
  creditCards: true,
  creditTransactions: true,
  receivables: true,
  transactions: true,
  rewards: true,
  investments: true,
};

export const NAVIGATION_PAGE_CONFIG = [
  { key: "cio", label: "Nest CIO", icon: "🧭" },
  { key: "budget", label: "Budget Plan", icon: "🗓" },
  { key: "transactions", label: "Transactions", icon: "📑" },
  { key: "creditCards", label: "Credit Cards", icon: "💳" },
  { key: "creditTransactions", label: "Card Transactions", icon: "🧾" },
  { key: "receivables", label: "Receivables", icon: "↩" },
  { key: "rewards", label: "Rewards", icon: "◎" },
  { key: "investments", label: "Investments", icon: "📈" },
];
export type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  isShared?: boolean;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  workspaces?: Array<{ id: string; name: string; role?: "OWNER" | "EDITOR" | "VIEWER" }>;
  sidebarMoneyPages?: Record<string, boolean>;
};

export type CollaboratorData = {
  role: "OWNER" | "EDITOR" | "VIEWER";
  workspace: { id: string; name: string; isShared: boolean } | null;
  members: ListEnvelope<{
    id: string;
    role: string;
    user: { id: string; name: string | null; email: string | null };
  }>;
  invites: ListEnvelope<{
    id: string;
    invitedEmail: string;
    status: string;
    role: "EDITOR" | "VIEWER";
    createdAt: string;
    expiresAt: string | null;
    invitedBy: { id: string; name: string | null; email: string | null } | null;
  }>;
  auditLogs: ListEnvelope<{
    id: string;
    action: string;
    details: string;
    createdAt: string;
    actorUser: { id: string; name: string | null; email: string | null } | null;
  }>;
};

export function contextWorkspaceMeta(context: AppContext | undefined) {
  if (!context?.workspaceId) return null;
  return { id: context.workspaceId, name: context.workspaceName || "", isShared: Boolean(context.isShared) };
}
