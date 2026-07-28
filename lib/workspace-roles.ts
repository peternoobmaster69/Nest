const WORKSPACE_ROLES = ["VIEWER", "EDITOR", "OWNER"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

export function normalizeWorkspaceRole(role: string): WorkspaceRole {
  // Existing MEMBER rows retain their historical write access until the migration runs.
  if (role === "MEMBER") return "EDITOR";
  if (WORKSPACE_ROLES.includes(role as WorkspaceRole)) return role as WorkspaceRole;
  return "VIEWER";
}

export function hasMinimumWorkspaceRole(role: WorkspaceRole, minimumRole: WorkspaceRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}
