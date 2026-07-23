export type AppShellContext = {
  workspaceId?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
  isAdmin?: boolean;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
  accounts?: Array<{ id: string; name: string; kind: string }>;
  setupProgress?: {
    bankAccountCount: number;
    subAccountCount: number;
    creditCardCount: number;
  };
};
